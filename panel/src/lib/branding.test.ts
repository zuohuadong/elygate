import { describe, expect, test } from "bun:test";
import {
	DEFAULT_APP_NAME,
	formatBrandText,
	getAppName,
	getEnName,
	getShortName,
	onAppNameChange,
	resolveAppName,
	resolveBranding,
	setAppName,
	setEnName,
	setShortName,
} from "./branding";
import { labelFor, registerElygateTranslations } from "./i18n";

describe("custom branding & app name", () => {
	test("resolves default app name when unconfigured", () => {
		setAppName(DEFAULT_APP_NAME);
		expect(getAppName()).toBe(DEFAULT_APP_NAME);
	});

	test("resolves custom app name from config document", () => {
		const name = resolveAppName({
			client_config: { app_name: "CustomGate" },
		});
		expect(name).toBe("CustomGate");
		expect(getAppName()).toBe("CustomGate");
	});

	test("notifies subscribers when the app name changes", () => {
		const observed: string[] = [];
		const unsubscribe = onAppNameChange((name) => observed.push(name));
		setAppName("ListenerBrand");
		unsubscribe();
		setAppName(DEFAULT_APP_NAME);
		expect(observed).toContain("ListenerBrand");
	});

	test("resolves custom app name, short name, en name, and logo from metadata or top-level field", () => {
		expect(resolveAppName({ app_name: "TopLevelBrand" })).toBe("TopLevelBrand");
		expect(resolveAppName({ metadata: { app_name: "MetaBrand" } })).toBe("MetaBrand");
		expect(resolveAppName({ metadata: { brand_name: "MetaBrand2" } })).toBe("MetaBrand2");

		const branding = resolveBranding({
			app_name: "CustomGateway",
			short_name: "CustomShort",
			en_name: "custom-en",
			logo_url: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
		});
		expect(branding.appName).toBe("CustomGateway");
		expect(branding.shortName).toBe("CustomShort");
		expect(branding.enName).toBe("custom-en");
		expect(branding.logoUrl).toBe("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
	});

	test("formats brand text replacing both Bifrost and Elygate", () => {
		const custom = "NovaProxy";
		setEnName("novaproxy");
		expect(formatBrandText("Welcome to Elygate and Bifrost gateway", custom)).toBe(
			"Welcome to NovaProxy and NovaProxy gateway"
		);
		expect(formatBrandText("docker compose restart elygate or bifrost", custom)).toBe(
			"docker compose restart novaproxy or novaproxy"
		);
	});

	test("registers translations with custom brand without showing original brand words", () => {
		setAppName("CloudLLM");
		registerElygateTranslations("CloudLLM");
		const zh = labelFor("zh-CN", "elygate.restartInstructions");
		const en = labelFor("en", "elygate.restartInstructions");
		const hint = labelFor("zh-CN", "elygate.loginHint");
		expect(zh).not.toContain("Elygate");
		expect(zh).not.toContain("Bifrost");
		expect(en).not.toContain("Elygate");
		expect(en).not.toContain("Bifrost");
		expect(hint).not.toContain("Elygate");
		expect(hint).not.toContain("Bifrost");
	});
});
