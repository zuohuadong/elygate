//#region src/hooks.server.ts
var handle = async ({ event, resolve }) => {
	return await resolve(event);
};
//#endregion
export { handle };
