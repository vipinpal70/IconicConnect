import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();


if (!process.env.RESEND_API_KEY) {
  throw new Error('Missing RESEND_API_KEY');
}

export const resend = new Resend(process.env.RESEND_API_KEY);