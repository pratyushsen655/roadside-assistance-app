import * as express from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        _id?: string;
        role: string;
        email?: string;
      };
      authInfo?: {
        role: string;
      };
    }
  }
}
