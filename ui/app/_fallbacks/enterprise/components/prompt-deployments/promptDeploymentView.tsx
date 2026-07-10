import { Router } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function PromptDeploymentView(_props?: { omitTitle?: boolean }) {
	return (
		<div className="w-full">
			<ContactUsView
				align="top"
				className="justify-start gap-3 rounded-md border p-4"
				icon={<Router className="h-8 w-8" strokeWidth={1.5} />}
				title="Unlock prompt deployments for better prompt versioning and A/B testing."
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/prompt-deployments"
			/>
		</div>
	);
}
