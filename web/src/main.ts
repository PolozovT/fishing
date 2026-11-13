import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './style.css';
import { initBackdrop } from './backdrop';
import { CHAIN_ID, chain, deployment } from './config';
import { h } from './ui/dom';

const app = document.getElementById('app')!;
initBackdrop();

// The game modules read the contract addresses as they load, so they are only imported once there are some.
if (deployment) {
  void import('./app');
} else {
  app.append(
    h(
      'div',
      { class: 'fatal' },
      h('h2', { text: `Not deployed on ${chain.name} yet` }),
      h('p', { text: `No contract addresses for chainId ${CHAIN_ID} (deployments/${CHAIN_ID}.json). Deploy with contracts/deploy-fluent.sh, then run pnpm sync.` }),
    ),
  );
}
