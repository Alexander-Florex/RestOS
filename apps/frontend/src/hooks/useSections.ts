import { useCallback, useEffect, useState } from 'react';
import { sectionsApi, type Section } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

export function useSections() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { sections } = await sectionsApi.list();
      setSections(sections);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    const onChanged = (s: Section) => setSections(prev => prev.map(x => x.id === s.id ? s : x));
    const onCreated = (s: Section) => setSections(prev => prev.some(x => x.id === s.id) ? prev : [...prev, s].sort((a, b) => a.order - b.order));
    const onDeleted = ({ id }: { id: number }) => setSections(prev => prev.filter(x => x.id !== id));
    socket.on(SocketEvents.SECTION_CHANGED, onChanged);
    socket.on(SocketEvents.SECTION_CREATED, onCreated);
    socket.on(SocketEvents.SECTION_DELETED, onDeleted);
    return () => {
      socket.off(SocketEvents.SECTION_CHANGED, onChanged);
      socket.off(SocketEvents.SECTION_CREATED, onCreated);
      socket.off(SocketEvents.SECTION_DELETED, onDeleted);
    };
  }, []);

  return { sections, loading, refresh };
}
