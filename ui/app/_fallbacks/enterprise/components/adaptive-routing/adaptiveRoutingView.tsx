import { Shuffle } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function AdaptiveRoutingView() {
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<Shuffle className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title="Unlock adaptive routing for better performance"
				description="This capability requires the Elygate Enterprise source package and is not included in this OSS build."
				readmeLink="https://docs.getbifrost.ai/enterprise/adaptive-load-balancing"
			/>
		</div>
	);
}
