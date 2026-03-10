import { browser } from '$app/environment';

type Theme = 'light' | 'dark';

function createThemeStore() {
    let theme = $state<Theme>('light');

    function init() {
        if (browser) {
            const stored = localStorage.getItem('theme') as Theme | null;
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            theme = stored || (prefersDark ? 'dark' : 'light');
            applyTheme(theme);
        }
    }

    function applyTheme(t: Theme) {
        if (browser) {
            const html = document.documentElement;
            if (t === 'dark') {
                html.classList.add('dark');
            } else {
                html.classList.remove('dark');
            }
            localStorage.setItem('theme', t);
        }
    }

    function toggle() {
        theme = theme === 'light' ? 'dark' : 'light';
        applyTheme(theme);
    }

    function set(t: Theme) {
        theme = t;
        applyTheme(theme);
    }

    return {
        get value() { return theme; },
        init,
        toggle,
        set
    };
}

export const theme = createThemeStore();
