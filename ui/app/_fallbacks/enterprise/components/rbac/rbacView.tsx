import { UserRoundCheck } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function RBACView() {
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<UserRoundCheck className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title="Unlock roles and permissions for better security"
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}
