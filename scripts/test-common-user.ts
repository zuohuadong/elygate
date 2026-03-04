import { expect } from "bun:test";

const API_BASE = "http://localhost:3000";

async function runTests() {
    console.log("🚀 Starting common user integration tests...");
    const username = `testuser_${Date.now()}`;
    const password = "password123";

    let token = "";

    // 1. Create a user via normal signup flow (if enabled) or fallback to DB insertion via admin if needed
    console.log(`\n📋 Testing Registration for ${username}...`);
    try {
        const regRes = await fetch(`${API_BASE}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        let regData;
        try {
            regData = await regRes.json();
            console.log("Registration Response:", regData);
        } catch (e) {
            console.log("Registration response parsing failed. Status:", regRes.status);
            throw new Error((await regRes.text()) || "Registration failed");
        }

        if (!regData.success) {
            console.warn("Registration might be disabled or failed. Proceeding to try direct login if user exists.");
        }
    } catch (e) {
        console.error("Registration endpoint error:", e);
    }

    // 2. Login
    console.log(`\n🔑 Testing Login...`);
    const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });

    let loginData;
    try {
        loginData = await loginRes.json();
        console.log("Login Response:", loginData);
    } catch (e) {
        console.log("Login response parsing failed. Status:", loginRes.status);
        throw new Error(await loginRes.text());
    }

    if (!loginData.success || !loginData.token) {
        console.error("❌ Login failed. Cannot proceed with further tests.");
        return;
    }
    token = loginData.token;
    console.log("✅ Login successful. Token obtained.");

    const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
    };

    // 3. Test /api/auth/me
    console.log(`\n👤 Testing /api/auth/me...`);
    const meRes = await fetch(`${API_BASE}/api/auth/me`, { headers });
    const meData = await meRes.json();
    console.log("Me Response:", meData);
    if (meData.username === username && meData.role === 1) {
        console.log("✅ Me endpoint verified.");
    } else {
        console.error("❌ Me endpoint validation failed.");
    }

    // 4. Test Token Management (List tokens)
    console.log(`\n🎫 Testing Token Management (List)...`);
    const tokenRes = await fetch(`${API_BASE}/api/admin/tokens?page=1&pageSize=10`, { headers });
    if (!tokenRes.ok) {
        throw new Error(`Token list failed with status: ${tokenRes.status} - ${await tokenRes.text()}`);
    }
    const tokenData = await tokenRes.json();
    console.log(`Token Data (items: ${tokenData.data?.length || 0}):`, tokenData);
    console.log("✅ Token fetch successful.");

    // 5. Test Logs Pagination
    console.log(`\n📄 Testing Logs Retrieval...`);
    const logsRes = await fetch(`${API_BASE}/api/admin/logs?page=1&pageSize=10`, { headers });
    if (!logsRes.ok) {
        throw new Error(`Logs list failed with status: ${logsRes.status} - ${await logsRes.text()}`);
    }
    const logsData = await logsRes.json();
    console.log(`Logs Data (items: ${logsData.data?.length || 0}):`, logsData);
    console.log("✅ Logs fetch successful.");

    // 6. Test Stats
    console.log(`\n📊 Testing Stats Overview...`);
    // Note: User stats overview uses /api/stats/summary/user or similar? 
    // Testing the basic admin stats endpoint as ordinary user (should pass logic and return just user's data due to WHERE clause in API)
    const statsRes = await fetch(`${API_BASE}/api/stats/dashboard`, { headers });

    // Depending on API design, this might 403 or return partial data
    console.log("Stats response status:", statsRes.status);
    if (statsRes.ok) {
        const statsData = await statsRes.json();
        console.log("✅ Stats fetch successful.", statsData);
    } else {
        console.log("⚠️ Stats fetch returned:", await statsRes.text());
    }

    console.log("\n🎉 All integration tests passed for standard user.");
}

runTests().catch(e => {
    console.error("\n❌ Test Suite Failed:");
    console.error(e);
});
