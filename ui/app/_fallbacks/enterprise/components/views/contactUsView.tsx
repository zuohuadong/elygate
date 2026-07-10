import { cn } from "@/lib/utils";

interface Props {
	className?: string;
	icon: React.ReactNode;
	title: string;
	description: string;
	readmeLink: string;
	align?: "middle" | "top";
	testIdPrefix?: string;
}

export default function ContactUsView({ icon, title, className, align = "middle", testIdPrefix }: Props) {
	return (
		<div className={cn("flex flex-col items-center gap-4 text-center", align === "middle" ? "justify-center" : "justify-start", className)}>
			<div className="text-muted-foreground">{icon}</div>
			<div className="flex flex-col gap-1">
				<h1 className="text-muted-foreground text-xl font-medium">{title}</h1>
				<div className="text-muted-foreground mt-2 max-w-[600px] text-sm font-normal" data-testid={testIdPrefix ? `${testIdPrefix}-source-unavailable` : undefined}>
					This capability requires the Elygate Enterprise source package and is not included in this OSS build.
				</div>
			</div>
		</div>
	);
}
