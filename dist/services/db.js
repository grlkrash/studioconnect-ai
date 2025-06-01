"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const prisma_1 = require("../../generated/prisma");
// Singleton pattern to prevent multiple database connections
exports.prisma = (_a = globalThis.__prisma) !== null && _a !== void 0 ? _a : new prisma_1.PrismaClient({
    log: ['query'],
});
// In development, save the instance to prevent hot reload from creating new connections
if (process.env.NODE_ENV !== 'production')
    globalThis.__prisma = exports.prisma;
// Graceful shutdown
process.on('beforeExit', () => __awaiter(void 0, void 0, void 0, function* () {
    yield exports.prisma.$disconnect();
}));
exports.default = exports.prisma;
