import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import '@fontsource/noto-nastaliq-urdu/arabic-400.css';
import './styles.css';

// Service worker caches the app so it opens without internet.
registerSW({ immediate: true });

// Ask the browser not to evict local clinic data under storage pressure.
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
