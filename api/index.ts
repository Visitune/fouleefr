import { createApp } from '../server/app.ts';

// Point d'entrée serverless Vercel : toutes les routes /api/* y sont réécrites (vercel.json).
export default createApp();
