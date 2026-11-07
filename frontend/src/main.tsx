import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './styles/grid-editor.css';
import './styles/auth.css';
import './styles/redis.css';
import './styles/chroma.css';
import './styles/agent.css';
import './styles/download.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
