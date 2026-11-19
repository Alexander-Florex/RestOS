// ──────────────────────────────────────────────
// windows.ts — Imprimir en una impresora instalada en Windows (USB) en modo RAW.
//
// Los bytes ESC/POS van tal cual a la cola de Windows (sin pasar por el driver que
// dibuja), con la API winspool (OpenPrinter / StartDocPrinter "RAW" / WritePrinter).
// Sin dependencias: un único PowerShell queda abierto y recibe pedidos por stdin
// (una línea JSON por pedido) y responde por stdout. Así el C# se compila una sola vez.
//
// Después de mandar, espera a que el trabajo salga de la cola de Windows. Si sigue
// ahí (impresora apagada, sin papel, desenchufada), lo saca de la cola y avisa el
// error: así el reintento no termina imprimiendo dos veces.
// ──────────────────────────────────────────────
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from '../logger.js';

export interface WindowsPrinter {
  name: string;
  offline: boolean;
  port: string | null;
  driver: string | null;
  isDefault: boolean;
}

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class RestosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr h, byte[] buf, int len, out int written);
  public static int Send(string printer, string title, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = title;
      di.pDataType = "RAW";
      int job = StartDocPrinter(h, 1, di);
      if (job == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h)) throw new Win32Exception(Marshal.GetLastWin32Error());
        int written;
        bool ok = WritePrinter(h, data, data.Length, out written);
        int err = Marshal.GetLastWin32Error();
        EndPagePrinter(h);
        if (!ok) throw new Win32Exception(err);
        if (written != data.Length) throw new Exception("La impresora recibió el ticket incompleto");
      } finally { EndDocPrinter(h); }
      return job;
    } finally { ClosePrinter(h); }
  }
}
"@

function Find-Printer([string]$name) {
  Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $name } | Select-Object -First 1
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $res = @{ id = $null; ok = $true }
  try {
    $req = $line | ConvertFrom-Json
    $res.id = $req.id
    if ($req.cmd -eq 'list') {
      $res.printers = @(Get-CimInstance Win32_Printer | ForEach-Object {
        @{ name = $_.Name; offline = [bool]$_.WorkOffline; port = $_.PortName; driver = $_.DriverName; isDefault = [bool]$_.Default }
      })
    } elseif ($req.cmd -eq 'print') {
      $p = Find-Printer $req.printer
      if (-not $p) { throw "Windows no tiene una impresora llamada '$($req.printer)'. Elegila de nuevo en la Comandera." }
      if ($p.WorkOffline) { throw 'Windows marca la impresora como desconectada: revisá que esté prendida y con el cable USB enchufado.' }
      $bytes = [Convert]::FromBase64String($req.data)
      $job = [RestosRawPrinter]::Send($req.printer, $req.title, $bytes)
      $res.job = $job
      $prefix = $req.printer + ','
      $deadline = (Get-Date).AddSeconds([int]$req.waitSeconds)
      $stuck = $null
      while ($true) {
        $j = Get-CimInstance Win32_PrintJob | Where-Object { $_.JobId -eq $job -and $_.Name.StartsWith($prefix) } | Select-Object -First 1
        if (-not $j) { $stuck = $null; break }
        $stuck = $j
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Milliseconds 300
      }
      if ($stuck) {
        $estado = [string]$stuck.JobStatus
        try { $stuck | Remove-CimInstance } catch { }
        $detalle = if ($estado) { " (Windows: $estado)" } else { '' }
        throw ("La impresora no tomó el ticket$detalle. Revisá que esté prendida, con papel y con la tapa cerrada.")
      }
    } else {
      throw "Pedido desconocido: $($req.cmd)"
    }
  } catch {
    $res.ok = $false
    $res.error = $_.Exception.Message
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
`;

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

let proc: ChildProcessWithoutNullStreams | null = null;
let buffer = '';
let nextId = 1;
const pending = new Map<number, Pending>();
let scriptPath: string | null = null;

function ensureScript(): string {
  if (scriptPath) return scriptPath;
  const dir = path.join(tmpdir(), 'restos-printer');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'raw-printer.ps1');
  // Con BOM: PowerShell 5.1 lee como ANSI los .ps1 sin BOM y rompería los acentos de los mensajes
  writeFileSync(file, '﻿' + SCRIPT.replace(/\r?\n/g, '\r\n'), 'utf8');
  scriptPath = file;
  return file;
}

function failAll(err: Error) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
    pending.delete(id);
  }
}

function helper(): ChildProcessWithoutNullStreams {
  if (proc && proc.exitCode === null && !proc.killed) return proc;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureScript()], {
    windowsHide: true,
  });
  buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(line); } catch { logger.warn('printer_helper_garbage', { line: line.slice(0, 200) }); continue; }
      const p = pending.get(Number(msg.id));
      if (!p) continue;
      clearTimeout(p.timer);
      pending.delete(Number(msg.id));
      p.resolve(msg);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => logger.warn('printer_helper_stderr', { text: d.slice(0, 500) }));
  child.on('exit', (code) => {
    if (proc === child) proc = null;
    failAll(new Error(`El ayudante de impresión de Windows se cerró (código ${code ?? '?'})`));
  });
  child.on('error', (err) => {
    if (proc === child) proc = null;
    failAll(new Error(`No se pudo abrir PowerShell para imprimir: ${err.message}`));
  });
  proc = child;
  return child;
}

function request(cmd: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Imprimir por USB solo funciona con el sistema instalado en Windows'));
  const child = helper();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // Colgado: se cierra y el próximo pedido abre uno nuevo
      child.kill();
      reject(new Error('Windows tardó demasiado en responder al imprimir'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ ...cmd, id }) + '\n');
  }).then((msg) => {
    const m = msg as Record<string, unknown>;
    if (m.ok !== true) throw new Error(String(m.error ?? 'Error de impresión'));
    return m;
  });
}

/** Impresoras instaladas en Windows */
export async function listWindowsPrinters(): Promise<WindowsPrinter[]> {
  // La primera vez compila el C#: puede tardar unos segundos
  const res = await request({ cmd: 'list' }, 30_000);
  const list = Array.isArray(res.printers) ? res.printers : res.printers ? [res.printers] : [];
  return (list as Array<Record<string, unknown>>).map((p) => ({
    name: String(p.name),
    offline: Boolean(p.offline),
    port: p.port ? String(p.port) : null,
    driver: p.driver ? String(p.driver) : null,
    isDefault: Boolean(p.isDefault),
  }));
}

/** Manda los bytes en RAW y espera a que Windows los entregue a la impresora */
export async function printRawWindows(printer: string, title: string, data: Buffer, waitSeconds = 20): Promise<void> {
  await request({ cmd: 'print', printer, title: title.slice(0, 120), data: data.toString('base64'), waitSeconds }, (waitSeconds + 30) * 1000);
}

/** Al apagar el servidor */
export function stopWindowsPrinterHelper() {
  if (proc) { proc.stdin.end(); proc.kill(); proc = null; }
}
