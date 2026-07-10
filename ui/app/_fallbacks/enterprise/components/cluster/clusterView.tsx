import { Layers } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function ClusterPage() {
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<Layers className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title="Unlock cluster mode to scale reliably"
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/clustering"
			/>
		</div>
	);
}
