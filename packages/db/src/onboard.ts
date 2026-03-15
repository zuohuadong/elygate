import { sql } from './index';

async function onboard() {
    const orgName = process.env.ORG_NAME || 'Default Enterprise';
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'password123';

    console.log(`[Onboard] Initializing system for ${orgName}...`);

    try {
        // 1. Create Organization
        const [org] = await sql`
            INSERT INTO organizations (name, slug, quota, status)
            VALUES (${orgName}, 'default', 100000000, 1)
            ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
        `;

        // 2. Create Super Admin
        const passwordHash = await Bun.password.hash(adminPass);

        await sql`
            INSERT INTO users (username, password_hash, role, org_id, quota, status)
            VALUES (${adminUser}, ${passwordHash}, 10, ${org.id}, 10000000, 1)
            ON CONFLICT (username) DO UPDATE SET 
                role = EXCLUDED.role,
                org_id = EXCLUDED.org_id
        `;

        console.log(`[Onboard] Success!`);
        console.log(`- Organization: ${orgName}`);
        console.log(`- Super Admin: ${adminUser}`);
        console.log(`- Default Password: ${adminPass}`);
        console.log(`\nNext Steps: Run 'docker-compose up' and log in to the portal.`);

    } catch (err) {
        console.error(`[Onboard] Failed:`, err);
        process.exit(1);
    }
}

onboard();
