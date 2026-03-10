type ShortcutCallback = () => void;

interface Shortcut {
    key: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
    callback: ShortcutCallback;
    description: string;
}

class KeyboardShortcuts {
    private shortcuts: Shortcut[] = [];
    private enabled = true;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', this.handleKeyDown.bind(this));
        }
    }

    private handleKeyDown(e: KeyboardEvent) {
        if (!this.enabled) return;
        
        if ((e.target as HTMLElement).tagName === 'INPUT' || 
            (e.target as HTMLElement).tagName === 'TEXTAREA') {
            return;
        }

        for (const shortcut of this.shortcuts) {
            const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : true;
            const metaMatch = shortcut.meta ? e.metaKey : true;
            const shiftMatch = shortcut.shift ? e.shiftKey : true;
            const altMatch = shortcut.alt ? e.altKey : true;
            const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

            if (ctrlMatch && metaMatch && shiftMatch && altMatch && keyMatch) {
                e.preventDefault();
                shortcut.callback();
                return;
            }
        }
    }

    register(shortcut: Shortcut) {
        this.shortcuts.push(shortcut);
        return () => {
            this.shortcuts = this.shortcuts.filter(s => s !== shortcut);
        };
    }

    registerMultiple(shortcuts: Shortcut[]) {
        shortcuts.forEach(s => this.register(s));
    }

    disable() {
        this.enabled = false;
    }

    enable() {
        this.enabled = true;
    }

    getShortcuts() {
        return [...this.shortcuts];
    }
}

export const keyboardShortcuts = new KeyboardShortcuts();

export const defaultShortcuts: Shortcut[] = [
    { key: 'k', ctrl: true, callback: () => {}, description: 'Open search' },
    { key: '/', callback: () => {}, description: 'Focus search' },
    { key: 'Escape', callback: () => {}, description: 'Close modal/dropdown' },
    { key: 'd', ctrl: true, callback: () => {}, description: 'Toggle dark mode' },
    { key: 'r', ctrl: true, callback: () => {}, description: 'Refresh data' },
];
