import { handleDecision } from '../../lib/decisions.js';

export const onRequest = ({ request }) => handleDecision(request);
