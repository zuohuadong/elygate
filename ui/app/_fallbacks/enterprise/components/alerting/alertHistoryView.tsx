import AlertingPlaceholderView from "./alertingPlaceholderView";

export default function AlertHistoryView() {
	return (
		<AlertingPlaceholderView
			title="Unlock alerting history for proactive monitoring"
			description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
			readmeLink="https://docs.getbifrost.ai/enterprise/alerting/alert-history"
			testIdPrefix="alert-history"
		/>
	);
}
