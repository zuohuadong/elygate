import { ShieldCheck } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function AccessProfilesIndexView() {
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<ShieldCheck className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title="Unlock access profiles for better performance"
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/access-profiles"
				testIdPrefix="access-profiles"
			/>
		</div>
	);
}
