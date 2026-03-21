const fs = require('fs');
const path = require('path');

function fixTypes() {
    const webSrc = path.join(__dirname, 'apps/web/src');
    
    function walk(dir) {
        fs.readdirSync(dir).forEach(file => {
            const p = path.join(dir, file);
            if (fs.statSync(p).isDirectory()) {
                walk(p);
            } else if (p.endsWith('.svelte') || p.endsWith('.ts')) {
                let src = fs.readFileSync(p, 'utf8');
                let modified = false;

                // Fix generic response wrapper fields
                
                // login & register
                if (src.includes('apiFetch<{token: string, user: Record<string, any>}>("/login"')) {
                    src = src.replace(/apiFetch<\{token: string, user: Record<string, any>\}>\("\/login"/g, 'apiFetch<{success?: boolean, message?: string, token?: string, user?: Record<string, any>}>("/login"');
                    modified = true;
                }
                if (src.includes('apiFetch<{token: string, user: Record<string, any>}>("/register"')) {
                    src = src.replace(/apiFetch<\{token: string, user: Record<string, any>\}>\("\/register"/g, 'apiFetch<{success?: boolean, message?: string, token?: string, user?: Record<string, any>}>("/register"');
                    modified = true;
                }
                
                // status
                if (src.includes('apiFetch<{status?: string, [key: string]: any}>("/status")')) {
                    src = src.replace(/apiFetch<\{status\?: string, \[key: string\]: any\}>\("\/status"\)/g, 'apiFetch<{success?: boolean, status?: string, [key: string]: any}>("/status")');
                    modified = true;
                }

                // payment create-order
                if (src.includes('apiFetch<{checkout_url?: string, payment?: any}>("/payment/create-order"')) {
                    src = src.replace(/apiFetch<\{checkout_url\?: string, payment\?: any\}>\("\/payment\/create-order"/g, 'apiFetch<{success?: boolean, message?: string, paymentUrl?: string, checkout_url?: string, url?: string, payment?: any}>("/payment/create-order"');
                    modified = true;
                }

                // Any Record<string, any> that accesses .success or .message
                // TypeScript allows Record<string, any> to access any string key, so it shouldn't error.

                if (modified) {
                    fs.writeFileSync(p, src);
                    console.log(`Patched ${p}`);
                }
            }
        });
    }
    walk(webSrc);
}

fixTypes();
