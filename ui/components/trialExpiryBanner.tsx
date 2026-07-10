export default function TrialExpiryBanner() {
	// The public Elygate build deliberately ships without a trial-licensed
	// Enterprise package, so no global expiry banner should be rendered.
	return null;
}
