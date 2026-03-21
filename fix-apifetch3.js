const fs = require('fs');
const path = require('path');

function finalFix() {
    const webSrc = path.join(__dirname, 'apps/web/src');
    
    function walk(dir) {
        fs.readdirSync(dir).forEach(file => {
            const p = path.join(dir, file);
            if (fs.statSync(p).isDirectory()) {
                walk(p);
            } else if (p.endsWith('.svelte') || p.endsWith('.ts')) {
                let src = fs.readFileSync(p, 'utf8');
                let modified = false;

                // login & register have flat properties that Svelte views access
                if (src.includes('apiFetch<{success?: boolean, message?: string, token?: string, user?: Record<string, any>}>("/login"')) {
                    src = src.replace(/apiFetch<\{success\?: boolean, message\?: string, token\?: string, user\?: Record<string, any>\}>\("\/login"/g, 'apiFetch<{success?: boolean, message?: string, token?: string, user?: Record<string, any>, [key: string]: any}>("/login"');
                    modified = true;
                }
                if (src.includes('apiFetch<{success?: boolean, message?: string, token?: string, user?: Record<string, any>}>("/register"')) {
                    src = src.replace(/apiFetch<\{success\?: boolean, message\?: string, token\?: string, user\?: Record<string, any>\}>\("\/register"/g, 'apiFetch<{success?: boolean, message?: string, token?: string, user?: Record<string, any>, [key: string]: any}>("/register"');
                    modified = true;
                }

                if (modified) {
                    fs.writeFileSync(p, src);
                    console.log(`Patched ${p}`);
                }
            }
        });
    }
    walk(webSrc);
}

finalFix();
