import { Construction } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function guardrailsProviderView() {
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<Construction className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title="Unlock guardrails for better security"
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/guardrails"
			/>
		</div>
	);
}
