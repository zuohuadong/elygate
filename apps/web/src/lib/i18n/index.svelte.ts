import { zh, en } from './translations';

type Language = 'zh' | 'en';

class I18nManager {
    lang = $state<Language>('zh');

    // Derived proxy for easier access
    t = $derived(this.lang === 'zh' ? zh : en);

    setLang(l: Language) {
        this.lang = l;
        if (typeof window !== 'undefined') {
            localStorage.setItem('elygate_lang', l);
        }
    }

    init() {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('elygate_lang') as Language;
            if (saved && (saved === 'zh' || saved === 'en')) {
                this.lang = saved;
            } else {
                // Auto detect from browser
                const browserLang = navigator.language.toLowerCase();
                if (browserLang.startsWith('en')) {
                    this.lang = 'en';
                } else {
                    this.lang = 'zh'; // Default to zh
                }
            }
        }
    }
}

export const i18n = new I18nManager();
