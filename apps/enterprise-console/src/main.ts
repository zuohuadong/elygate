import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

try {
  mount(App, { target: document.getElementById('app')! });
  console.log('[elygate-enterprise] Console mounted successfully');
} catch (error) {
  console.error('[elygate-enterprise] Failed to mount console:', error);
  document.getElementById('app')!.innerHTML = `<pre style="color:red;padding:2em">${error}</pre>`;
}
