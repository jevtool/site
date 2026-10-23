// TypeSafe SDK compatibility: TYPESAFE_BASE_URL=https://jevtool.dev
import { handleDecision } from '../../lib/decisions.js';

export const onRequest = ({ request }) => handleDecision(request);
