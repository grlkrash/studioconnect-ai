// Type overrides and ambient module declarations for packages lacking @types

declare module 'multer'
declare module 'pdf-parse'

declare namespace Express {
  // Add typings for middleware-added `file` property used by multer
  interface Request {
    file?: Express.Multer.File
  }
} 