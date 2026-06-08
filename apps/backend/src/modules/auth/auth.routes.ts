// ──────────────────────────────────────────────
// auth.routes.ts — Endpoints públicos y protegidos de auth
// ──────────────────────────────────────────────
import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();

// POST /api/auth/login — público
router.post('/login', asyncHandler(authController.login));

// GET /api/auth/me — requiere token
router.get('/me', authenticate, asyncHandler(authController.me));

export { router as authRouter };
