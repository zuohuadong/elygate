import { BookUser } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function SCIMView() {
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<BookUser className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title="Unlock SCIM based access management for user provisioning"
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}
