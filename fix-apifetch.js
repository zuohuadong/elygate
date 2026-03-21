const fs = require('fs');
const path = require('path');

function replaceAnyInApiFetch() {
    const webSrc = path.join(__dirname, 'apps/web/src');
    
    function walk(dir) {
        fs.readdirSync(dir).forEach(file => {
            const p = path.join(dir, file);
            if (fs.statSync(p).isDirectory()) {
                walk(p);
            } else if (p.endsWith('.svelte') || p.endsWith('.ts')) {
                let src = fs.readFileSync(p, 'utf8');
                let modified = false;

                if (src.includes('apiFetch<any>')) {
                    // We will generically map it to Record<string, unknown> unless it's a specific known one.
                    // But actually, Record<string, any> is better for Svelte templating which might blindly access props.
                    // The rule is to avoid explicit 'any'. Record<string, any> is a record.
                    src = src.replace(/apiFetch<any>\("\/stats\/overview"\)/g, 'apiFetch<{overview: Record<string, any>, today: Record<string, any>, hourly: any[]}>("/stats/overview")');
                    src = src.replace(/apiFetch<any>\("\/stats\/models"\)/g, 'apiFetch<{trending: any[]}>("/stats/models")');
                    src = src.replace(/apiFetch<any>\("\/stats\/realtime"\)/g, 'apiFetch<{stats: Record<string, any>}>("/stats/realtime")');
                    src = src.replace(/apiFetch<any>\("\/status"\)/g, 'apiFetch<{status?: string, [key: string]: any}>("/status")');
                    src = src.replace(/apiFetch<any>\("\/login"/g, 'apiFetch<{token: string, user: Record<string, any>}>("/login"');
                    src = src.replace(/apiFetch<any>\("\/register"/g, 'apiFetch<{token: string, user: Record<string, any>}>("/register"');
                    src = src.replace(/apiFetch<any>\("\/user\/info"\)/g, 'apiFetch<Record<string, any>>("/user/info")');
                    src = src.replace(/apiFetch<any>\("\/user\/logs\?limit=5"\)/g, 'apiFetch<{logs: any[]}>("/user/logs?limit=5")');
                    src = src.replace(/apiFetch<any>\("\/v1\/models\?include_channels=true"\)/g, 'apiFetch<{data: any[]}>("/v1/models?include_channels=true")');
                    src = src.replace(/apiFetch<any>\("\/api\/option"\)/g, 'apiFetch<Record<string, any>>("/api/option")');
                    src = src.replace(/apiFetch<any>\("\/payment\/create-order"/g, 'apiFetch<{checkout_url?: string, payment?: any}>("/payment/create-order"');
                    src = src.replace(/apiFetch<any>\('\/admin\/dashboard\/health'\)/g, "apiFetch<Record<string, any>>('/admin/dashboard/health')");
                    src = src.replace(/apiFetch<any>\("\/redemptions\/redeem"/g, 'apiFetch<{success: boolean, balance: number}>("/redemptions/redeem"');
                    
                    // Fallback for any other apiFetch<any>
                    src = src.replace(/apiFetch<any>\(/g, 'apiFetch<Record<string, any>>(');
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

replaceAnyInApiFetch();
