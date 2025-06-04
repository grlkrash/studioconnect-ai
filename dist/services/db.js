"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
// Singleton pattern to prevent multiple database connections
exports.prisma = globalThis.__prisma ??
    new client_1.PrismaClient({
        log: ['query'],
    });
// In development, save the instance to prevent hot reload from creating new connections
if (process.env.NODE_ENV !== 'production')
    globalThis.__prisma = exports.prisma;
// Graceful shutdown
process.on('beforeExit', async () => {
    await exports.prisma.$disconnect();
});
exports.default = exports.prisma;
//# sourceMappingURL=db.js.map