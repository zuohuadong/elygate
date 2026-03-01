import { $ } from "bun";

async function generateChangelog() {
    let gitLogCmd;

    // Attempt to get the latest tag before this commit
    try {
        const prevTagObj = await $`git describe --tags --abbrev=0 HEAD^`.quiet();
        const prevTag = prevTagObj.stdout.toString().trim();
        if (prevTag) {
            console.log(`Generating changelog from ${prevTag} to HEAD`);
            gitLogCmd = $`git log ${prevTag}..HEAD --pretty=format:"%s"`.quiet();
        } else {
            throw new Error("No previous tag found");
        }
    } catch (e) {
        console.log(`No previous tag found. Generating changelog for all commits.`);
        gitLogCmd = $`git log --pretty=format:"%s"`.quiet();
    }

    const logs = await gitLogCmd;
    const commits = logs.stdout.toString().split('\n').filter(Boolean);

    const categories = {
        feat: { en: '🚀 Features', zh: '🚀 新特性', items: [] as string[] },
        fix: { en: '🐛 Bug Fixes', zh: '🐛 问题修复', items: [] as string[] },
        perf: { en: '⚡ Performance', zh: '⚡ 性能优化', items: [] as string[] },
        docs: { en: '📝 Documentation', zh: '📝 文档更新', items: [] as string[] },
        refactor: { en: '♻️ Code Refactoring', zh: '♻️ 代码重构', items: [] as string[] },
        chore: { en: '🔧 Chores & Maintenance', zh: '🔧 日常维护', items: [] as string[] },
    };

    const uncategorized: string[] = [];

    // Parse commits based on conventional commits
    for (const commit of commits) {
        // Match example: "feat(db): optimized query speed" or "fix: resolve memory leak"
        const match = commit.match(/^(feat|fix|perf|docs|refactor|chore)(?:\((.*?)\))?:\s*(.*)$/);
        if (match) {
            const type = match[1] as keyof typeof categories;
            const scope = match[2] ? `**${match[2]}**: ` : '';
            const msg = match[3];
            categories[type].items.push(`- ${scope}${msg}`);
        } else if (!commit.startsWith("Merge ") && !commit.startsWith("bump ") && !commit.startsWith("v0.")) {
            uncategorized.push(`- ${commit}`);
        }
    }

    let changelog = `## 📦 Release Notes / 版本更新日志\n\n`;

    for (const [key, cat] of Object.entries(categories)) {
        if (cat.items.length > 0) {
            changelog += `### ${cat.en} | ${cat.zh}\n`;
            changelog += cat.items.join('\n') + `\n\n`;
        }
    }

    if (uncategorized.length > 0) {
        changelog += `### 💡 Other Changes | 其他更新\n`;
        changelog += uncategorized.join('\n') + `\n\n`;
    }

    await Bun.write("RELEASE_NOTE.md", changelog);
    console.log("Written to RELEASE_NOTE.md successfully!");
}

generateChangelog().catch(console.error);
