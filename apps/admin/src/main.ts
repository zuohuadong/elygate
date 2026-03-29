import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

try {
  const app = mount(App, { target: document.getElementById('app')! });
  console.log('[elygate] App mounted successfully');
} catch (e) {
  console.error('[elygate] Failed to mount app:', e);
  document.getElementById('app')!.innerHTML = `<pre style="color:red;padding:2em">${e}</pre>`;
}
