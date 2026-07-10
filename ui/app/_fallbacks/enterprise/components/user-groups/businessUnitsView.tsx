import { Building2 } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export function BusinessUnitsView() {
	return (
		<div className="w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				testIdPrefix="business-units-governance"
				icon={<Building2 className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title="Unlock business units & advanced governance"
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}
