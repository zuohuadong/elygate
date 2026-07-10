import AlertingPlaceholderView from "./alertingPlaceholderView";

export default function AlertChannelsView() {
	return (
		<AlertingPlaceholderView
			title="Unlock alerting channels for proactive monitoring"
			description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
			readmeLink="https://docs.getbifrost.ai/enterprise/alerting/alert-channels"
			testIdPrefix="alert-channels"
		/>
	);
}
