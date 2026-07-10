import AlertingPlaceholderView from "./alertingPlaceholderView";

export default function AlertRulesView() {
	return (
		<AlertingPlaceholderView
			title="Unlock alerting rules for proactive monitoring"
			description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
			readmeLink="https://docs.getbifrost.ai/enterprise/alerting/alert-rules"
			testIdPrefix="alert-rules"
		/>
	);
}
