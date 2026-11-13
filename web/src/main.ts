import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './style.css';
import { initBackdrop } from './backdrop';
import { LOCAL_GAME } from './config';

initBackdrop();
// Local play is the game for now; the contract client takes over with VITE_GAME_MODE=onchain after a deployment.
if (LOCAL_GAME) void import('./play/app');
else void import('./app');
