import { Users } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function UsersView() {
	return (
		<div className="w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<Users className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title="Unlock users & user governance"
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}
