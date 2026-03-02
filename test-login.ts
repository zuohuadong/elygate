async function run() {
    try {
        const res = await fetch("http://localhost:3000/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username: "admin", password: "wrong" }),
            headers: { "Content-Type": "application/json" }
        });
        console.log("STATUS:", res.status);
        console.log("HEADER:", res.headers.get("content-type"));
        const text = await res.text();
        console.log("BODY:", text);
    } catch (e) {
        console.error("ERR:", e);
    }
}
run();
