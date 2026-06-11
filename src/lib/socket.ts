import type { Server as IOServer } from 'socket.io';

const globalForIO = globalThis as unknown as { io?: IOServer };

export function setIO(io: IOServer) {
  globalForIO.io = io;
}

export function getIO(): IOServer | undefined {
  return globalForIO.io;
}
