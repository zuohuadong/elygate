//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/entity.js
var entityKind = Symbol.for("drizzle:entityKind");
function is(value, type) {
	if (!value || typeof value !== "object") return false;
	if (value instanceof type) return true;
	if (!Object.prototype.hasOwnProperty.call(type, entityKind)) throw new Error(`Class "${type.name ?? "<unknown>"}" doesn't look like a Drizzle entity. If this is incorrect and the class is provided by Drizzle, please report this as a bug.`);
	let cls = Object.getPrototypeOf(value)?.constructor;
	if (cls) while (cls) {
		if (entityKind in cls && cls[entityKind] === type[entityKind]) return true;
		cls = Object.getPrototypeOf(cls);
	}
	return false;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/logger.js
var ConsoleLogWriter = class {
	static [entityKind] = "ConsoleLogWriter";
	write(message) {
		console.log(message);
	}
};
var DefaultLogger = class {
	static [entityKind] = "DefaultLogger";
	writer;
	constructor(config) {
		this.writer = config?.writer ?? new ConsoleLogWriter();
	}
	logQuery(query, params) {
		const stringifiedParams = params.map((p) => {
			try {
				return JSON.stringify(p);
			} catch {
				return String(p);
			}
		});
		const paramsStr = stringifiedParams.length ? ` -- params: [${stringifiedParams.join(", ")}]` : "";
		this.writer.write(`Query: ${query}${paramsStr}`);
	}
};
var NoopLogger = class {
	static [entityKind] = "NoopLogger";
	logQuery() {}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/cache/core/cache.js
var Cache = class {
	static [entityKind] = "Cache";
};
var NoopCache = class extends Cache {
	static [entityKind] = "NoopCache";
	strategy() {
		return "all";
	}
	async get(_key) {}
	async put(_hashedQuery, _response, _tables, _config) {}
	async onMutate(_params) {}
};
var strategyFor = async (query, params, queryMetadata, withCacheConfig) => {
	if (!queryMetadata) return { type: "skip" };
	const { type, tables } = queryMetadata;
	if ((type === "insert" || type === "update" || type === "delete") && tables.length > 0) return {
		type: "invalidate",
		tables
	};
	if (!withCacheConfig) return { type: "skip" };
	if (!withCacheConfig.enabled) return { type: "skip" };
	if (type === "select") return {
		type: "try",
		key: withCacheConfig.tag ?? await hashQuery(query, params),
		isTag: typeof withCacheConfig.tag !== "undefined",
		autoInvalidate: withCacheConfig.autoInvalidate,
		tables: queryMetadata.tables,
		config: withCacheConfig.config
	};
	return { type: "skip" };
};
async function hashQuery(sql, params) {
	const dataToHash = `${sql}-${JSON.stringify(params, (_, v) => typeof v === "bigint" ? `${v}n` : v)}`;
	const data = new TextEncoder().encode(dataToHash);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/column-common.js
var OriginalColumn = Symbol.for("drizzle:OriginalColumn");
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/column.js
var noop = (v) => v;
noop.isNoop = true;
var Column = class {
	static [entityKind] = "Column";
	/** @internal */
	codec;
	name;
	keyAsName;
	primary;
	notNull;
	default;
	defaultFn;
	onUpdateFn;
	hasDefault;
	isUnique;
	uniqueName;
	uniqueType;
	dataType;
	columnType;
	enumValues = void 0;
	generated = void 0;
	generatedIdentity = void 0;
	length;
	isLengthExact;
	isAlias;
	/** @internal */
	config;
	/** @internal */
	table;
	/** @internal */
	onInit() {}
	constructor(table, config) {
		this.config = config;
		this.onInit();
		this.table = table;
		this.name = config.name;
		this.isAlias = false;
		this.keyAsName = config.keyAsName;
		this.notNull = config.notNull;
		this.default = config.default;
		this.defaultFn = config.defaultFn;
		this.onUpdateFn = config.onUpdateFn;
		this.hasDefault = config.hasDefault;
		this.primary = config.primaryKey;
		this.isUnique = config.isUnique;
		this.uniqueName = config.uniqueName;
		this.uniqueType = config.uniqueType;
		this.dataType = config.dataType;
		this.columnType = config.columnType;
		this.generated = config.generated;
		this.generatedIdentity = config.generatedIdentity;
		this.length = config["length"];
		this.isLengthExact = config["isLengthExact"];
	}
	mapFromDriverValue = noop;
	mapToDriverValue = noop;
	/** @internal */
	postBuild() {
		return this;
	}
	/** @internal */
	shouldDisableInsert() {
		return this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
	}
	/** @internal */
	[OriginalColumn]() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/table.utils.js
/** @internal */
var TableName = Symbol.for("drizzle:Name");
var MySqlColumn = class extends Column {
	static [entityKind] = "MySqlColumn";
	/** @internal */
	table;
	constructor(table, config) {
		super(table, config);
		this.table = table;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/subquery.js
var Subquery = class {
	static [entityKind] = "Subquery";
	constructor(sql, fields, alias, isWith = false, usedTables = []) {
		this._ = {
			brand: "Subquery",
			sql,
			selectedFields: fields,
			alias,
			isWith,
			usedTables
		};
	}
};
var WithSubquery = class extends Subquery {
	static [entityKind] = "WithSubquery";
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/table.js
/** @internal */
var TableSchema = Symbol.for("drizzle:Schema");
/** @internal */
var TableColumns = Symbol.for("drizzle:Columns");
/** @internal */
var ExtraConfigColumns = Symbol.for("drizzle:ExtraConfigColumns");
/** @internal */
var OriginalName = Symbol.for("drizzle:OriginalName");
/** @internal */
var BaseName = Symbol.for("drizzle:BaseName");
/** @internal */
var IsAlias = Symbol.for("drizzle:IsAlias");
/** @internal */
var ExtraConfigBuilder = Symbol.for("drizzle:ExtraConfigBuilder");
var IsDrizzleTable = Symbol.for("drizzle:IsDrizzleTable");
var Table = class {
	static [entityKind] = "Table";
	/** @internal */
	static Symbol = {
		Name: TableName,
		Schema: TableSchema,
		OriginalName,
		Columns: TableColumns,
		ExtraConfigColumns,
		BaseName,
		IsAlias,
		ExtraConfigBuilder
	};
	/**
	* @internal
	* Can be changed if the table is aliased.
	*/
	[TableName];
	/**
	* @internal
	* Used to store the original name of the table, before any aliasing.
	*/
	[OriginalName];
	/** @internal */
	[TableSchema];
	/** @internal */
	[TableColumns];
	/** @internal */
	[ExtraConfigColumns];
	/**
	*  @internal
	* Used to store the table name before the transformation via the `tableCreator` functions.
	*/
	[BaseName];
	/** @internal */
	[IsAlias] = false;
	/** @internal */
	[IsDrizzleTable] = true;
	/** @internal */
	[ExtraConfigBuilder] = void 0;
	constructor(name, schema, baseName) {
		this[TableName] = this[OriginalName] = name;
		this[TableSchema] = schema;
		this[BaseName] = baseName;
	}
};
function getTableName(table) {
	return table[TableName];
}
function getTableUniqueName(table) {
	return `${table[TableSchema] ?? "public"}.${table[TableName]}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/tracing-utils.js
function iife(fn, ...args) {
	return fn(...args);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/tracing.js
/** @internal */
var tracer = { startActiveSpan(name, fn) {
	return fn();
} };
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/view-common.js
var ViewBaseConfig = Symbol.for("drizzle:ViewBaseConfig");
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sql/sql.js
function isSQLWrapper(value) {
	return value !== null && value !== void 0 && typeof value.getSQL === "function";
}
function mergeQueries(queries) {
	const result = {
		sql: "",
		params: []
	};
	for (const query of queries) {
		result.sql += query.sql;
		result.params.push(...query.params);
	}
	return result;
}
function _mergeQueries(queries) {
	const result = {
		sql: "",
		params: []
	};
	const sqls = [];
	for (const query of queries) {
		sqls.push(query.sql);
		result.params.push(...query.params);
	}
	result._sql = Object.assign(sqls, { raw: sqls });
	return result;
}
var StringChunk = class {
	static [entityKind] = "StringChunk";
	value;
	constructor(value) {
		this.value = Array.isArray(value) ? value : [value];
	}
	getSQL() {
		return new SQL$1([this]);
	}
};
var SQL$1 = class SQL {
	static [entityKind] = "SQL";
	/** @internal */
	decoder = noopDecoder;
	/** @internal */
	shouldInlineParams = false;
	/** @internal */
	usedTables = [];
	constructor(queryChunks) {
		this.queryChunks = queryChunks;
		for (const chunk of queryChunks) if (is(chunk, Table)) {
			const schemaName = chunk[Table.Symbol.Schema];
			this.usedTables.push(schemaName === void 0 ? chunk[Table.Symbol.Name] : schemaName + "." + chunk[Table.Symbol.Name]);
		}
	}
	append(query) {
		this.queryChunks.push(...query.queryChunks);
		return this;
	}
	toQuery(config) {
		return tracer.startActiveSpan("drizzle.buildSQL", (span) => {
			const query = this.buildQueryFromSourceParams(this.queryChunks, config);
			span?.setAttributes({
				"drizzle.query.text": query.sql,
				"drizzle.query.params": JSON.stringify(query.params)
			});
			return query;
		});
	}
	buildQueryFromSourceParams(chunks, _config) {
		const config = Object.assign({}, _config, {
			inlineParams: _config.inlineParams || this.shouldInlineParams,
			paramStartIndex: _config.paramStartIndex || { value: 0 }
		});
		const { escapeName, escapeParam, codecs, inlineParams, paramStartIndex, invokeSource } = config;
		const mappedChunks = chunks.map((chunk) => {
			if (is(chunk, StringChunk)) return {
				sql: chunk.value.join(""),
				params: []
			};
			if (is(chunk, Name)) return {
				sql: escapeName(chunk.value),
				params: []
			};
			if (chunk === void 0) return {
				sql: "",
				params: []
			};
			if (Array.isArray(chunk)) {
				const result = [new StringChunk("(")];
				for (const [i, p] of chunk.entries()) {
					result.push(p);
					if (i < chunk.length - 1) result.push(new StringChunk(", "));
				}
				result.push(new StringChunk(")"));
				return this.buildQueryFromSourceParams(result, config);
			}
			if (is(chunk, SQL)) return this.buildQueryFromSourceParams(chunk.queryChunks, {
				...config,
				inlineParams: inlineParams || chunk.shouldInlineParams
			});
			if (is(chunk, Table)) {
				const schemaName = chunk[Table.Symbol.Schema];
				const tableName = chunk[Table.Symbol.Name];
				if (invokeSource === "mssql-view-with-schemabinding") return {
					sql: (schemaName === void 0 ? escapeName("dbo") : escapeName(schemaName)) + "." + escapeName(tableName),
					params: []
				};
				return {
					sql: schemaName === void 0 || chunk[IsAlias] ? escapeName(tableName) : escapeName(schemaName) + "." + escapeName(tableName),
					params: []
				};
			}
			if (is(chunk, Column)) {
				const columnName = chunk.name;
				if (_config.invokeSource === "indexes") return {
					sql: escapeName(columnName),
					params: []
				};
				const schemaName = invokeSource === "mssql-check" ? void 0 : chunk.table[Table.Symbol.Schema];
				return {
					sql: chunk.isAlias ? escapeName(chunk.name) : chunk.table[IsAlias] || schemaName === void 0 ? escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName) : escapeName(schemaName) + "." + escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName),
					params: []
				};
			}
			if (is(chunk, View)) {
				const schemaName = chunk[ViewBaseConfig].schema;
				const viewName = chunk[ViewBaseConfig].name;
				return {
					sql: schemaName === void 0 || chunk[ViewBaseConfig].isAlias ? escapeName(viewName) : escapeName(schemaName) + "." + escapeName(viewName),
					params: []
				};
			}
			if (is(chunk, Param)) {
				if (is(chunk.value, SQL)) return this.buildQueryFromSourceParams([chunk.value], config);
				const useCodecs = codecs && is(chunk.encoder, Column);
				if (is(chunk.value, Placeholder)) {
					const escaped = escapeParam(paramStartIndex.value++, chunk);
					chunk.codec = useCodecs ? (value) => codecs.apply(chunk.encoder, "normalizeParam", value) : void 0;
					return {
						sql: useCodecs ? codecs.apply(chunk.encoder, "castParam", escaped) : escaped,
						params: [chunk]
					};
				}
				let mappedValue;
				if (chunk.value === null) mappedValue = chunk.value;
				else {
					mappedValue = chunk.encoder.mapToDriverValue.isNoop ? chunk.value : chunk.encoder.mapToDriverValue(chunk.value);
					if (is(mappedValue, SQL)) return this.buildQueryFromSourceParams([mappedValue], config);
					if (useCodecs) mappedValue = codecs.apply(chunk.encoder, "normalizeParam", mappedValue);
				}
				if (inlineParams) return {
					sql: this.mapInlineParam(mappedValue, config),
					params: []
				};
				const escaped = escapeParam(paramStartIndex.value++, mappedValue);
				return {
					sql: useCodecs ? codecs.apply(chunk.encoder, "castParam", escaped) : escaped,
					params: [mappedValue]
				};
			}
			if (is(chunk, Placeholder)) return {
				sql: escapeParam(paramStartIndex.value++, chunk),
				params: [chunk]
			};
			if (is(chunk, SQL.Aliased) && chunk.fieldAlias !== void 0) return {
				sql: (chunk.origin !== void 0 ? escapeName(chunk.origin) + "." : "") + escapeName(chunk.fieldAlias),
				params: []
			};
			if (is(chunk, Subquery)) {
				if (chunk._.isWith) return {
					sql: escapeName(chunk._.alias),
					params: []
				};
				return this.buildQueryFromSourceParams([
					new StringChunk("("),
					chunk._.sql,
					new StringChunk(") "),
					new Name(chunk._.alias)
				], config);
			}
			if (typeof chunk === "function" && "enumName" in chunk) {
				if ("schema" in chunk && chunk.schema) return {
					sql: escapeName(chunk.schema) + "." + escapeName(chunk.enumName),
					params: []
				};
				return {
					sql: escapeName(chunk.enumName),
					params: []
				};
			}
			if (isSQLWrapper(chunk)) {
				if (chunk.shouldOmitSQLParens?.()) return this.buildQueryFromSourceParams([chunk.getSQL()], config);
				return this.buildQueryFromSourceParams([
					new StringChunk("("),
					chunk.getSQL(),
					new StringChunk(")")
				], config);
			}
			if (inlineParams) return {
				sql: this.mapInlineParam(chunk, config),
				params: []
			};
			return {
				sql: escapeParam(paramStartIndex.value++, chunk),
				params: [chunk]
			};
		});
		if (_config.tagged) return _mergeQueries(mappedChunks);
		return mergeQueries(mappedChunks);
	}
	mapInlineParam(chunk, { escapeString }) {
		if (chunk === null) return "null";
		if (typeof chunk === "number" || typeof chunk === "boolean" || typeof chunk === "bigint") return chunk.toString();
		if (typeof chunk === "string") return escapeString(chunk);
		if (typeof chunk === "object") {
			const mappedValueAsString = chunk.toString();
			if (mappedValueAsString === "[object Object]") return escapeString(JSON.stringify(chunk));
			return escapeString(mappedValueAsString);
		}
		throw new Error("Unexpected param value: " + chunk);
	}
	getSQL() {
		return this;
	}
	as(alias) {
		if (alias === void 0) return this;
		return new SQL.Aliased(this, alias);
	}
	mapWith(decoder) {
		this.decoder = typeof decoder === "function" ? { mapFromDriverValue: decoder } : decoder;
		return this;
	}
	inlineParams() {
		this.shouldInlineParams = true;
		return this;
	}
	/**
	* This method is used to conditionally include a part of the query.
	*
	* @param condition - Condition to check
	* @returns itself if the condition is `true`, otherwise `undefined`
	*/
	if(condition) {
		return condition ? this : void 0;
	}
};
/**
* Any DB name (table, column, index etc.)
*/
var Name = class {
	static [entityKind] = "Name";
	brand;
	constructor(value) {
		this.value = value;
	}
	getSQL() {
		return new SQL$1([this]);
	}
};
function isDriverValueEncoder(value) {
	return typeof value === "object" && value !== null && "mapToDriverValue" in value && typeof value.mapToDriverValue === "function";
}
var noopDecoder = { mapFromDriverValue: (value) => value };
noopDecoder.mapFromDriverValue.isNoop = true;
var noopEncoder = { mapToDriverValue: (value) => value };
noopEncoder.mapToDriverValue.isNoop = true;
({
	...noopDecoder,
	...noopEncoder
});
/** Parameter value that is optionally bound to an encoder (for example, a column). */
var Param = class {
	static [entityKind] = "Param";
	brand;
	/**
	* @param value - Parameter value
	* @param encoder - Encoder to convert the value to a driver parameter
	*/
	constructor(value, encoder = noopEncoder, codec) {
		this.value = value;
		this.encoder = encoder;
		this.codec = codec;
	}
	getSQL() {
		return new SQL$1([this]);
	}
};
function sql$1(strings, ...params) {
	const queryChunks = [];
	if (params.length > 0 || strings.length > 0 && strings[0] !== "") queryChunks.push(new StringChunk(strings[0]));
	for (const [paramIndex, param] of params.entries()) queryChunks.push(param, new StringChunk(strings[paramIndex + 1]));
	return new SQL$1(queryChunks);
}
(function(_sql) {
	function empty() {
		return new SQL$1([]);
	}
	_sql.empty = empty;
	function fromList(list) {
		return new SQL$1(list);
	}
	_sql.fromList = fromList;
	function raw(str) {
		return new SQL$1([new StringChunk(str)]);
	}
	_sql.raw = raw;
	function join(chunks, separator) {
		const result = [];
		for (const [i, chunk] of chunks.entries()) {
			if (i > 0 && separator !== void 0) result.push(separator);
			result.push(chunk);
		}
		return new SQL$1(result);
	}
	_sql.join = join;
	function identifier(value) {
		return new Name(value);
	}
	_sql.identifier = identifier;
	function placeholder(name) {
		return new Placeholder(name);
	}
	_sql.placeholder = placeholder;
	function param(value, encoder) {
		return new Param(value, encoder);
	}
	_sql.param = param;
	function comment(input) {
		const encoded = sqlCommenter(input);
		if (!encoded.length) return void 0;
		return sql$1.raw(encoded);
	}
	_sql.comment = comment;
})(sql$1 || (sql$1 = {}));
function sqlCommenter(input) {
	const encoded = sqlCommenter.encodeInput(input);
	if (!encoded.length) return "";
	return `/*${encoded}*/`;
}
(function(_sqlCommenter) {
	function merge(input1, input2) {
		let encoded;
		if (typeof input1 === "object" && typeof input2 === "object") encoded = encodeInput({
			...input1,
			...input2
		});
		else if (input1 && input2) encoded = [encodeInput(input1), encodeInput(input2)].filter((i) => i.length).join(",");
		else if (input2) encoded = encodeInput(input2);
		else if (input1) encoded = encodeInput(input1);
		else return "";
		if (!encoded.length) return "";
		return `/*${encoded}*/`;
	}
	_sqlCommenter.merge = merge;
	function encodeInput(input) {
		if (typeof input === "string") {
			if (!input.length) return input;
			return sanitizeStringInput(input);
		}
		const parts = [];
		for (const [key, value] of Object.entries(input)) {
			if (value === null || value === void 0 || value === "") continue;
			const encodedKey = sanitizeObjectElement(key);
			const encodedValue = sanitizeObjectElement(String(value));
			parts.push(`${encodedKey}='${encodedValue}'`);
		}
		if (!parts.length) return "";
		return parts.sort().join(",");
	}
	_sqlCommenter.encodeInput = encodeInput;
	function sanitizeObjectElement(key) {
		return encodeURIComponent(key).replace(/'/g, `\\'`);
	}
	_sqlCommenter.sanitizeObjectElement = sanitizeObjectElement;
	function sanitizeStringInput(input) {
		return input.replace(/\/\*/g, "/ *").replace(/\*\//g, "* /");
	}
	_sqlCommenter.sanitizeStringInput = sanitizeStringInput;
})(sqlCommenter || (sqlCommenter = {}));
(function(_SQL) {
	class Aliased {
		static [entityKind] = "SQL.Aliased";
		/** @internal */
		isSelectionField = false;
		/** @internal */
		origin;
		constructor(sql, fieldAlias) {
			this.sql = sql;
			this.fieldAlias = fieldAlias;
		}
		getSQL() {
			return this.sql;
		}
		/** @internal */
		clone() {
			return new Aliased(this.sql, this.fieldAlias);
		}
	}
	_SQL.Aliased = Aliased;
})(SQL$1 || (SQL$1 = {}));
var Placeholder = class {
	static [entityKind] = "Placeholder";
	constructor(name) {
		this.name = name;
	}
	getSQL() {
		return new SQL$1([this]);
	}
};
function fillPlaceholders(params, values) {
	return params.map((p) => {
		if (is(p, Placeholder)) {
			if (!(p.name in values)) throw new Error(`No value for placeholder "${p.name}" was provided`);
			return values[p.name];
		}
		if (is(p, Param) && is(p.value, Placeholder)) {
			if (!(p.value.name in values)) throw new Error(`No value for placeholder "${p.value.name}" was provided`);
			if (values[p.value.name] === null) return values[p.value.name];
			const mapped = p.encoder.mapToDriverValue.isNoop ? values[p.value.name] : p.encoder.mapToDriverValue(values[p.value.name]);
			return p.codec ? p.codec(mapped) : mapped;
		}
		return p;
	});
}
var IsDrizzleView = Symbol.for("drizzle:IsDrizzleView");
var View = class {
	static [entityKind] = "View";
	/** @internal */
	[ViewBaseConfig];
	/** @internal */
	[IsDrizzleView] = true;
	/** @internal */
	get [TableName]() {
		return this[ViewBaseConfig].name;
	}
	/** @internal */
	get [TableSchema]() {
		return this[ViewBaseConfig].schema;
	}
	/** @internal */
	get [IsAlias]() {
		return this[ViewBaseConfig].isAlias;
	}
	/** @internal */
	get [OriginalName]() {
		return this[ViewBaseConfig].originalName;
	}
	/** @internal */
	get [TableColumns]() {
		return this[ViewBaseConfig].selectedFields;
	}
	constructor({ name, schema, selectedFields, query }) {
		this[ViewBaseConfig] = {
			name,
			originalName: name,
			schema,
			selectedFields,
			query,
			isExisting: !query,
			isAlias: false
		};
	}
};
Column.prototype.getSQL = function() {
	return new SQL$1([this]);
};
Subquery.prototype.getSQL = function() {
	return new SQL$1([this]);
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/utils.js
/** @internal */
function mapResultRow(columns, row, joinsNotNullableMap) {
	const nullifyMap = {};
	const result = columns.reduce((result, { path, field, codec, arrayDimensions }, columnIndex) => {
		let decoder;
		if (is(field, Column)) decoder = field;
		else if (is(field, SQL$1)) decoder = field.decoder;
		else if (is(field, Subquery)) decoder = field._.sql.decoder;
		else decoder = field.sql.decoder;
		let node = result;
		for (const [pathChunkIndex, pathChunk] of path.entries()) if (pathChunkIndex < path.length - 1) {
			if (!(pathChunk in node)) node[pathChunk] = {};
			node = node[pathChunk];
		} else {
			const rawValue = row[columnIndex];
			const value = node[pathChunk] = rawValue === null ? null : decoder.mapFromDriverValue(codec ? codec(rawValue, arrayDimensions) : rawValue);
			if (joinsNotNullableMap && is(field, Column) && path.length === 2) {
				const objectName = path[0];
				if (!(objectName in nullifyMap)) nullifyMap[objectName] = value === null ? getTableName(field.table) : false;
				else if (typeof nullifyMap[objectName] === "string" && nullifyMap[objectName] !== getTableName(field.table)) nullifyMap[objectName] = false;
			}
		}
		return result;
	}, {});
	if (joinsNotNullableMap && Object.keys(nullifyMap).length > 0) {
		for (const [objectName, tableName] of Object.entries(nullifyMap)) if (typeof tableName === "string" && !joinsNotNullableMap[tableName]) result[objectName] = null;
	}
	return result;
}
/** @internal bypass bundle-time filtering */
var FnConstructor = Object.getPrototypeOf(() => null).constructor;
/** @internal */
function makeJitQueryMapperInner(columns, joinsNotNullableMap = {}) {
	const preFn = [];
	const fn = [];
	fn.push(`const [ ${columns.map((_, i) => `c${i}`).join(", ")} ] = rows[i];`);
	const nullifyMap = {};
	const objectIds = {};
	const decodes = Array.from({ length: columns.length });
	for (let idx = 0; idx < columns.length; ++idx) {
		const { field, path, codec, arrayDimensions } = columns[idx];
		let decoder;
		let decoderStr;
		let decoderFieldDestructure;
		let isColumn = false;
		if (is(field, Column)) {
			isColumn = true;
			decoder = field;
			decoderFieldDestructure = `field: decoder${idx}`;
		} else if (is(field, SQL$1)) {
			decoder = field.decoder;
			decoderFieldDestructure = `field: { decoder: decoder${idx} }`;
		} else if (is(field, Subquery)) {
			decoder = field._.sql.decoder;
			decoderFieldDestructure = `field: { _: { sql: { decoder: decoder${idx} } } }`;
		} else {
			decoder = field.sql.decoder;
			decoderFieldDestructure = `field: { sql: { decoder: decoder${idx} } }`;
		}
		decoderStr = `decoder${idx}.mapFromDriverValue`;
		if (decoder.mapFromDriverValue.isNoop) decoderStr = "";
		if (decoderStr) preFn.push(`const { ${decoderFieldDestructure}${codec ? `, codec: codec${idx}` : ""} } = columns[${idx}];`);
		else if (codec) preFn.push(`const { codec: codec${idx} } = columns[${idx}];`);
		const colStr = `c${idx}`;
		let decodedValue = colStr;
		if (codec) decodedValue = `codec${idx}(${decodedValue}, ${arrayDimensions})`;
		if (decoderStr) decodedValue = `${decoderStr}(${decodedValue})`;
		decodes[idx] = colStr === decodedValue ? `${colStr}` : `${colStr} === null ? ${colStr} : ${decodedValue}`;
		if (path.length !== 2 || !isColumn) continue;
		if (objectIds[path[0]] === void 0) objectIds[path[0]] = [`c${idx}`];
		else objectIds[path[0]]?.push(`c${idx}`);
		const [objectName] = path;
		const tableName = getTableName(field.table);
		nullifyMap[objectName] = joinsNotNullableMap[tableName] ? false : typeof nullifyMap[objectName] === "string" ? nullifyMap[objectName] === tableName ? tableName : false : tableName;
	}
	fn.push(`mapped[i] = {`);
	let currentObjectPath = [];
	for (let idx = 0; idx < columns.length; ++idx) {
		const { path } = columns[idx];
		const jsonPath = path.map((e) => JSON.stringify(e));
		const decodedValue = decodes[idx];
		const objectPath = path.slice(0, -1);
		let commonLen = 0;
		while (commonLen < currentObjectPath.length && commonLen < objectPath.length && currentObjectPath[commonLen] === objectPath[commonLen]) commonLen++;
		for (let d = currentObjectPath.length - 1; d >= commonLen; --d) fn.push(`${"	".repeat(d + 1)}},`);
		for (let d = commonLen; d < objectPath.length; ++d) fn.push(`${"	".repeat(d + 1)}${jsonPath[d]}: ${d === 0 && objectPath.length === 1 && typeof nullifyMap[path[0]] === "string" ? `${objectIds[path[0]]?.map((c) => `${c} === null`).join(" && ")} ? null : {` : "{"}`);
		currentObjectPath = objectPath;
		fn.push(`${"	".repeat(path.length)}${jsonPath[path.length - 1]}: ${decodedValue},`);
	}
	for (let d = currentObjectPath.length - 1; d >= 0; --d) fn.push(`${"	".repeat(d + 1)}},`);
	fn.push(`};`);
	return `${preFn.length ? `${preFn.join("\n	")}\n\t` : ""}for (let i = 0; i < length; ++i) {
		${fn.join("\n		")}
	}`;
}
function makeJitQueryMapper(columns, joinsNotNullableMap) {
	const internals = `\t"use strict";
	const { columns } = this;
	const { length } = rows;
	const mapped = Array.from({ length });
	${makeJitQueryMapperInner(columns, joinsNotNullableMap)}
	return mapped;
	//# sourceURL=drizzle:jit-query-mapper`;
	return Object.assign(new FnConstructor("rows", internals).bind({ columns }), { body: `function jitQueryMapper (rows) {\n${internals}\n}` });
}
/** @internal */
function jitCompatCheck(isEnabled) {
	if (!isEnabled) return false;
	try {
		const res = new FnConstructor("input", "\"use strict\"; return input;")(true);
		if (res !== true) {
			console.warn("Unable to use jit mappers due to incompatibility: corrupted jit function output.\nFalling back to premade mappers.\nError details:");
			console.error(`Expected to receive \`true\`, got: ${res}`);
		}
		return true;
	} catch (e) {
		console.warn("Unable to use jit mappers due to incompatibility.\nFalling back to premade mappers.\nError details:");
		console.error(e);
		return false;
	}
}
function makeDefaultQueryMapper(columns, joinsNotNullableMap) {
	const interpretedData = columns.map(({ field, codec, arrayDimensions, path }) => {
		let processNullifyMap;
		let decoderSrc;
		if (is(field, Column)) {
			decoderSrc = field;
			if (joinsNotNullableMap && path.length === 2) {
				const objectName = path[0];
				processNullifyMap = (nullifyMap, value) => {
					if (!(objectName in nullifyMap)) nullifyMap[objectName] = value === null ? getTableName(field.table) : false;
					else if (typeof nullifyMap[objectName] === "string" && nullifyMap[objectName] !== getTableName(field.table)) nullifyMap[objectName] = false;
				};
			}
		} else if (is(field, SQL$1)) decoderSrc = field.decoder;
		else if (is(field, Subquery)) decoderSrc = field._.sql.decoder;
		else decoderSrc = field.sql.decoder;
		let decoder;
		if (decoderSrc.mapFromDriverValue.isNoop) decoder = codec ? (v) => codec(v, arrayDimensions) : void 0;
		else decoder = codec ? (v) => decoderSrc.mapFromDriverValue(codec(v, arrayDimensions)) : (v) => decoderSrc.mapFromDriverValue(v);
		return [decoder, processNullifyMap];
	});
	return ((rows) => rows.map((row) => {
		const nullifyMap = {};
		const result = columns.reduce((result, { path }, columnIndex) => {
			let node = result;
			for (const [pathChunkIndex, pathChunk] of path.entries()) if (pathChunkIndex < path.length - 1) {
				if (!(pathChunk in node)) node[pathChunk] = {};
				node = node[pathChunk];
			} else {
				const [decoder, processNullifyMap] = interpretedData[columnIndex];
				const rawValue = row[columnIndex];
				const value = node[pathChunk] = rawValue === null ? null : decoder ? decoder(rawValue) : rawValue;
				processNullifyMap?.(nullifyMap, value);
			}
			return result;
		}, {});
		if (joinsNotNullableMap && Object.keys(nullifyMap).length > 0) {
			for (const [objectName, tableName] of Object.entries(nullifyMap)) if (typeof tableName === "string" && !joinsNotNullableMap[tableName]) result[objectName] = null;
		}
		return result;
	}));
}
function make$ReturningResponseMapper(returningIds, generatedIds) {
	if (!returningIds) return;
	return ({ insertId, affectedRows }) => {
		const returningResponse = [];
		let j = 0;
		for (let i = insertId; i < insertId + affectedRows; i++) {
			for (const column of returningIds) {
				const key = returningIds[0].path[0];
				if (is(column.field, Column)) {
					if (column.field.primary && column.field.autoIncrement) returningResponse.push({ [key]: i });
					if (column.field.defaultFn && generatedIds) returningResponse.push({ [key]: generatedIds[j][key] });
				}
			}
			j++;
		}
		return returningResponse;
	};
}
/** @internal */
function orderSelectedFields(fields, pathPrefix, codecs) {
	return Object.entries(fields).reduce((result, [name, field]) => {
		if (typeof name !== "string") return result;
		const newPath = pathPrefix ? [...pathPrefix, name] : [name];
		if (is(field, Column)) result.push({
			path: newPath,
			field,
			codec: codecs?.get(field, "normalize"),
			arrayDimensions: field.dimensions
		});
		else if (is(field, SQL$1) || is(field, SQL$1.Aliased)) {
			const col = getColumnFromDecoder(field);
			result.push(col ? {
				path: newPath,
				field,
				codec: codecs?.get(col, "normalize"),
				arrayDimensions: col.dimensions
			} : {
				path: newPath,
				field
			});
		} else if (is(field, Subquery)) {
			const col = getColumnFromDecoder(field._.sql);
			result.push(col ? {
				path: newPath,
				field,
				codec: codecs?.get(col, "normalize"),
				arrayDimensions: col.dimensions
			} : {
				path: newPath,
				field
			});
		} else if (is(field, Table)) result.push(...orderSelectedFields(field[Table.Symbol.Columns], newPath, codecs));
		else result.push(...orderSelectedFields(field, newPath, codecs));
		return result;
	}, []);
}
function getColumnFromDecoder(source) {
	const query = source.getSQL();
	if (is(query.decoder, Column)) return query.decoder;
}
function haveSameKeys(left, right) {
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const [index, key] of leftKeys.entries()) if (key !== rightKeys[index]) return false;
	return true;
}
/** @internal */
function mapUpdateSet(table, values) {
	const entries = Object.entries(values).filter(([, value]) => value !== void 0).map(([key, value]) => {
		if (is(value, SQL$1) || is(value, Column)) return [key, value];
		else return [key, new Param(value, table[Table.Symbol.Columns][key])];
	});
	if (entries.length === 0) throw new Error("No values to set");
	return Object.fromEntries(entries);
}
/** @internal */
function applyMixins(baseClass, extendedClasses) {
	for (const extendedClass of extendedClasses) for (const name of Object.getOwnPropertyNames(extendedClass.prototype)) {
		if (name === "constructor") continue;
		Object.defineProperty(baseClass.prototype, name, Object.getOwnPropertyDescriptor(extendedClass.prototype, name) || Object.create(null));
	}
}
/**
* @deprecated
* Use `getColumns` instead
*/
function getTableColumns(table) {
	return table[Table.Symbol.Columns];
}
/** @internal */
function getTableLikeName(table) {
	return is(table, Subquery) ? table._.alias : is(table, View) ? table[ViewBaseConfig].name : is(table, SQL$1) ? void 0 : table[Table.Symbol.IsAlias] ? table[Table.Symbol.Name] : table[Table.Symbol.BaseName];
}
/** @internal */
function getColumnNameAndConfig(a, b) {
	return {
		name: typeof a === "string" && a.length > 0 ? a : "",
		config: typeof a === "object" ? a : b
	};
}
typeof TextDecoder === "undefined" || new TextDecoder();
function assertUnreachable(_x) {
	throw new Error("Didn't expect to get here");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/casing.js
function toSnakeCase(input) {
	return (input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).map((word) => word.toLowerCase()).join("_");
}
function toCamelCase(input) {
	return (input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).reduce((acc, word, i) => {
		return acc + (i === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1)}`);
	}, "");
}
function getCasingFn(casing) {
	if (casing === "snake_case") return toSnakeCase;
	if (casing === "camelCase") return toCamelCase;
	return (name) => name;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/table.js
/** @internal */
var InlineForeignKeys$2 = Symbol.for("drizzle:MySqlInlineForeignKeys");
var MySqlTable = class extends Table {
	static [entityKind] = "MySqlTable";
	/** @internal */
	static Symbol = Object.assign({}, Table.Symbol, { InlineForeignKeys: InlineForeignKeys$2 });
	/** @internal */
	[Table.Symbol.Columns];
	/** @internal */
	[InlineForeignKeys$2] = [];
	/** @internal */
	[Table.Symbol.ExtraConfigBuilder] = void 0;
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/indexes.js
var IndexBuilder = class {
	static [entityKind] = "MySqlIndexBuilder";
	/** @internal */
	config;
	constructor(name, columns, unique) {
		this.config = {
			name,
			columns,
			unique
		};
	}
	using(using) {
		this.config.using = using;
		return this;
	}
	algorithm(algorithm) {
		this.config.algorithm = algorithm;
		return this;
	}
	lock(lock) {
		this.config.lock = lock;
		return this;
	}
	/** @internal */
	build(table) {
		return new Index(this.config, table);
	}
};
var Index = class {
	static [entityKind] = "MySqlIndex";
	config;
	isNameExplicit;
	constructor(config, table) {
		this.config = {
			...config,
			table
		};
		this.isNameExplicit = !!config.name;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/utils.js
function extractUsedTable$2(table) {
	if (is(table, MySqlTable)) return [`${table[Table.Symbol.BaseName]}`];
	if (is(table, Subquery)) return table._.usedTables ?? [];
	if (is(table, SQL$1)) return table.usedTables ?? [];
	return [];
}
function convertIndexToString(indexes) {
	return indexes.map((idx) => {
		return typeof idx === "object" ? is(idx, IndexBuilder) ? idx.config.name : idx.name : idx;
	});
}
function toArray(value) {
	return Array.isArray(value) ? value : [value];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/view-base.js
var MySqlViewBase = class extends View {
	static [entityKind] = "MySqlViewBase";
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/alias.js
var ColumnTableAliasProxyHandler = class {
	static [entityKind] = "ColumnTableAliasProxyHandler";
	constructor(table, ignoreColumnAlias) {
		this.table = table;
		this.ignoreColumnAlias = ignoreColumnAlias;
	}
	get(columnObj, prop) {
		if (prop === "table") return this.table;
		if (prop === "isAlias" && this.ignoreColumnAlias) return false;
		return columnObj[prop];
	}
};
var ViewSelectionAliasProxyHandler = class {
	static [entityKind] = "ViewSelectionAliasProxyHandler";
	constructor(view, selection, ignoreColumnAlias) {
		this.view = view;
		this.selection = selection;
		this.ignoreColumnAlias = ignoreColumnAlias;
	}
	get(selection, prop) {
		const value = selection[prop];
		if (is(value, Column)) return new Proxy(value, new ColumnTableAliasProxyHandler(this.view, this.ignoreColumnAlias));
		if (is(value, Subquery) || is(value, SQL$1) || is(value, SQL$1.Aliased) || isSQLWrapper(value) || typeof value !== "object" || value === null) return value;
		return new Proxy(value, this);
	}
};
var TableAliasProxyHandler = class {
	static [entityKind] = "TableAliasProxyHandler";
	constructor(alias, replaceOriginalName, ignoreColumnAlias) {
		this.alias = alias;
		this.replaceOriginalName = replaceOriginalName;
		this.ignoreColumnAlias = ignoreColumnAlias;
	}
	get(target, prop) {
		if (prop === Table.Symbol.IsAlias) return true;
		if (prop === Table.Symbol.Name) return this.alias;
		if (this.replaceOriginalName && prop === Table.Symbol.OriginalName) return this.alias;
		if (prop === ViewBaseConfig) return {
			...target[ViewBaseConfig],
			name: this.alias,
			isAlias: true,
			selectedFields: new Proxy(target[ViewBaseConfig].selectedFields, new ViewSelectionAliasProxyHandler(new Proxy(target, this), target[ViewBaseConfig].selectedFields, this.ignoreColumnAlias))
		};
		if (prop === Table.Symbol.Columns) {
			const columns = target[Table.Symbol.Columns];
			if (!columns) return columns;
			if (is(target, View)) return new Proxy(target[Table.Symbol.Columns], new ViewSelectionAliasProxyHandler(new Proxy(target, this), target[Table.Symbol.Columns], this.ignoreColumnAlias));
			const proxiedColumns = {};
			Object.keys(columns).map((key) => {
				proxiedColumns[key] = new Proxy(columns[key], new ColumnTableAliasProxyHandler(new Proxy(target, this), this.ignoreColumnAlias));
			});
			return proxiedColumns;
		}
		const value = target[prop];
		if (is(value, Column)) return new Proxy(value, new ColumnTableAliasProxyHandler(new Proxy(target, this), this.ignoreColumnAlias));
		return value;
	}
};
var ColumnAliasProxyHandler = class {
	static [entityKind] = "ColumnAliasProxyHandler";
	constructor(alias) {
		this.alias = alias;
	}
	get(target, prop) {
		if (prop === "isAlias") return true;
		if (prop === "name") return this.alias;
		if (prop === "keyAsName") return false;
		if (prop === OriginalColumn) return () => target;
		return target[prop];
	}
};
function aliasedTable(table, tableAlias) {
	return new Proxy(table, new TableAliasProxyHandler(tableAlias, false, false));
}
function aliasedColumn(column, alias) {
	return new Proxy(column, new ColumnAliasProxyHandler(alias));
}
function aliasedTableColumn(column, tableAlias) {
	return new Proxy(column, new ColumnTableAliasProxyHandler(new Proxy(column.table, new TableAliasProxyHandler(tableAlias, false, false)), false));
}
function mapColumnsInAliasedSQLToAlias(query, alias) {
	return new SQL$1.Aliased(mapColumnsInSQLToAlias(query.sql, alias), query.fieldAlias);
}
function mapColumnsInSQLToAlias(query, alias) {
	return sql$1.join(query.queryChunks.map((c) => {
		if (is(c, Column)) return aliasedTableColumn(c, alias);
		if (is(c, SQL$1)) return mapColumnsInSQLToAlias(c, alias);
		if (is(c, SQL$1.Aliased)) return mapColumnsInAliasedSQLToAlias(c, alias);
		return c;
	}));
}
Column.prototype.as = function(alias) {
	return aliasedColumn(this, alias);
};
function getOriginalColumnFromAlias(column) {
	return column[OriginalColumn]();
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/selection-proxy.js
var SelectionProxyHandler = class SelectionProxyHandler {
	static [entityKind] = "SelectionProxyHandler";
	config;
	constructor(config) {
		this.config = { ...config };
	}
	get(subquery, prop) {
		if (prop === "_") return {
			...subquery["_"],
			selectedFields: new Proxy(subquery._.selectedFields, this)
		};
		if (prop === ViewBaseConfig) return {
			...subquery[ViewBaseConfig],
			selectedFields: new Proxy(subquery[ViewBaseConfig].selectedFields, this)
		};
		if (typeof prop === "symbol") return subquery[prop];
		const value = (is(subquery, Subquery) ? subquery._.selectedFields : is(subquery, View) ? subquery[ViewBaseConfig].selectedFields : subquery)[prop];
		if (is(value, SQL$1.Aliased)) {
			if (this.config.sqlAliasedBehavior === "sql" && !value.isSelectionField) return value.sql;
			const newValue = value.clone();
			newValue.isSelectionField = true;
			newValue.origin = this.config.alias;
			return newValue;
		}
		if (is(value, SQL$1)) {
			if (this.config.sqlBehavior === "sql") return value;
			throw new Error(`You tried to reference "${prop}" field from a subquery, which is a raw SQL field, but it doesn't have an alias declared. Please add an alias to the field using ".as('alias')" method.`);
		}
		if (is(value, Column)) {
			if (this.config.alias) return new Proxy(value, new ColumnTableAliasProxyHandler(new Proxy(value.table, new TableAliasProxyHandler(this.config.alias, this.config.replaceOriginalName ?? false, true)), true));
			return value;
		}
		if (typeof value !== "object" || value === null) return value;
		return new Proxy(value, new SelectionProxyHandler(this.config));
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/query-builders/query-builder.js
var TypedQueryBuilder = class {
	static [entityKind] = "TypedQueryBuilder";
	/** @internal */
	getSelectedFields() {
		return this._.selectedFields;
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/query-promise.js
var QueryPromise = class {
	static [entityKind] = "QueryPromise";
	[Symbol.toStringTag] = "QueryPromise";
	catch(onRejected) {
		return this.then(void 0, onRejected);
	}
	finally(onFinally) {
		return this.then((value) => {
			onFinally?.();
			return value;
		}, (reason) => {
			onFinally?.();
			throw reason;
		});
	}
	then(onFulfilled, onRejected) {
		return this.execute().then(onFulfilled, onRejected);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/query-builders/select.js
var MySqlSelectBuilder = class {
	static [entityKind] = "MySqlSelectBuilder";
	fields;
	session;
	dialect;
	withList = [];
	distinct;
	constructor(config) {
		this.fields = config.fields;
		this.session = config.session;
		this.dialect = config.dialect;
		if (config.withList) this.withList = config.withList;
		this.distinct = config.distinct;
	}
	from(source, onIndex) {
		const isPartialSelect = !!this.fields;
		let fields;
		if (this.fields) fields = this.fields;
		else if (is(source, Subquery)) fields = Object.fromEntries(Object.keys(source._.selectedFields).map((key) => [key, source[key]]));
		else if (is(source, MySqlViewBase)) fields = source[ViewBaseConfig].selectedFields;
		else if (is(source, SQL$1)) fields = {};
		else fields = getTableColumns(source);
		let useIndex = [];
		let forceIndex = [];
		let ignoreIndex = [];
		if (is(source, MySqlTable) && onIndex && typeof onIndex !== "string") {
			if (onIndex.useIndex) useIndex = convertIndexToString(toArray(onIndex.useIndex));
			if (onIndex.forceIndex) forceIndex = convertIndexToString(toArray(onIndex.forceIndex));
			if (onIndex.ignoreIndex) ignoreIndex = convertIndexToString(toArray(onIndex.ignoreIndex));
		}
		return new MySqlSelectBase({
			table: source,
			fields,
			isPartialSelect,
			session: this.session,
			dialect: this.dialect,
			withList: this.withList,
			distinct: this.distinct,
			useIndex,
			forceIndex,
			ignoreIndex
		});
	}
};
var MySqlSelectQueryBuilderBase = class extends TypedQueryBuilder {
	static [entityKind] = "MySqlSelectQueryBuilder";
	_;
	config;
	joinsNotNullableMap;
	tableName;
	isPartialSelect;
	/** @internal */
	session;
	dialect;
	cacheConfig = void 0;
	usedTables = /* @__PURE__ */ new Set();
	constructor({ table, fields, isPartialSelect, session, dialect, withList, distinct, useIndex, forceIndex, ignoreIndex }) {
		super();
		this.config = {
			withList,
			table,
			fields: { ...fields },
			distinct,
			setOperators: [],
			useIndex,
			forceIndex,
			ignoreIndex
		};
		this.isPartialSelect = isPartialSelect;
		this.session = session;
		this.dialect = dialect;
		this._ = {
			selectedFields: fields,
			config: this.config
		};
		this.tableName = getTableLikeName(table);
		this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
		for (const item of extractUsedTable$2(table)) this.usedTables.add(item);
	}
	/** @internal */
	getUsedTables() {
		return [...this.usedTables];
	}
	createJoin(joinType, lateral) {
		return (table, a, b) => {
			const isCrossJoin = joinType === "cross";
			let on = isCrossJoin ? void 0 : a;
			const onIndex = isCrossJoin ? a : b;
			const baseTableName = this.tableName;
			const tableName = getTableLikeName(table);
			for (const item of extractUsedTable$2(table)) this.usedTables.add(item);
			if (typeof tableName === "string" && this.config.joins?.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
			if (!this.isPartialSelect) {
				if (Object.keys(this.joinsNotNullableMap).length === 1 && typeof baseTableName === "string") this.config.fields = { [baseTableName]: this.config.fields };
				if (typeof tableName === "string" && !is(table, SQL$1)) {
					const selection = is(table, Subquery) ? table._.selectedFields : is(table, View) ? table[ViewBaseConfig].selectedFields : table[Table.Symbol.Columns];
					this.config.fields[tableName] = selection;
				}
			}
			if (typeof on === "function") on = on(new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "sql",
				sqlBehavior: "sql"
			})));
			if (!this.config.joins) this.config.joins = [];
			let useIndex = [];
			let forceIndex = [];
			let ignoreIndex = [];
			if (is(table, MySqlTable) && onIndex && typeof onIndex !== "string") {
				if (onIndex.useIndex) useIndex = convertIndexToString(toArray(onIndex.useIndex));
				if (onIndex.forceIndex) forceIndex = convertIndexToString(toArray(onIndex.forceIndex));
				if (onIndex.ignoreIndex) ignoreIndex = convertIndexToString(toArray(onIndex.ignoreIndex));
			}
			this.config.joins.push({
				on,
				table,
				joinType,
				alias: tableName,
				useIndex,
				forceIndex,
				ignoreIndex,
				lateral
			});
			if (typeof tableName === "string") switch (joinType) {
				case "left":
					this.joinsNotNullableMap[tableName] = false;
					break;
				case "right":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "cross":
				case "inner":
					this.joinsNotNullableMap[tableName] = true;
					break;
			}
			return this;
		};
	}
	/**
	* Executes a `left join` operation by adding another table to the current query.
	*
	* Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#left-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	* @param onIndex index hint.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User; pets: Pet | null; }[] = await db.select()
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId with use index hint
	* const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId), {
	*     useIndex: ['pets_owner_id_index']
	* })
	* ```
	*/
	leftJoin = this.createJoin("left", false);
	/**
	* Executes a `left join lateral` operation by adding subquery to the current query.
	*
	* A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
	*
	* Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#left-join-lateral}
	*
	* @param table the subquery to join.
	* @param on the `on` clause.
	*/
	leftJoinLateral = this.createJoin("left", true);
	/**
	* Executes a `right join` operation by adding another table to the current query.
	*
	* Calling this method associates each row of the joined table with the corresponding row from the main table, if a match is found. If no matching row exists, it sets all columns of the main table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#right-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	* @param onIndex index hint.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User | null; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .rightJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number | null; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .rightJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId with use index hint
	* const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId), {
	*     useIndex: ['pets_owner_id_index']
	* })
	* ```
	*/
	rightJoin = this.createJoin("right", false);
	/**
	* Executes an `inner join` operation, creating a new table by combining rows from two tables that have matching values.
	*
	* Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#inner-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	* @param onIndex index hint.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .innerJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .innerJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId with use index hint
	* const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId), {
	*     useIndex: ['pets_owner_id_index']
	* })
	* ```
	*/
	innerJoin = this.createJoin("inner", false);
	/**
	* Executes an `inner join lateral` operation, creating a new table by combining rows from two queries that have matching values.
	*
	* A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
	*
	* Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#inner-join-lateral}
	*
	* @param table the subquery to join.
	* @param on the `on` clause.
	*/
	innerJoinLateral = this.createJoin("inner", true);
	/**
	* Executes a `cross join` operation by combining rows from two tables into a new table.
	*
	* Calling this method retrieves all rows from both main and joined tables, merging all rows from each table.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#cross-join}
	*
	* @param table the table to join.
	* @param onIndex index hint.
	*
	* @example
	*
	* ```ts
	* // Select all users, each user with every pet
	* const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .crossJoin(pets)
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .crossJoin(pets)
	*
	* // Select userId and petId with use index hint
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .crossJoin(pets, {
	*     useIndex: ['pets_owner_id_index']
	* })
	* ```
	*/
	crossJoin = this.createJoin("cross", false);
	/**
	* Executes a `cross join lateral` operation by combining rows from two queries into a new table.
	*
	* A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
	*
	* Calling this method retrieves all rows from both main and joined queries, merging all rows from each query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#cross-join-lateral}
	*
	* @param table the query to join.
	*/
	crossJoinLateral = this.createJoin("cross", true);
	createSetOperator(type, isAll) {
		return (rightSelection) => {
			const rightSelect = typeof rightSelection === "function" ? rightSelection(getMySqlSetOperators()) : rightSelection;
			if (!haveSameKeys(this.getSelectedFields(), rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
			this.config.setOperators.push({
				type,
				isAll,
				rightSelect
			});
			return this;
		};
	}
	/**
	* Adds `union` set operator to the query.
	*
	* Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
	*
	* @example
	*
	* ```ts
	* // Select all unique names from customers and users tables
	* await db.select({ name: users.name })
	*   .from(users)
	*   .union(
	*     db.select({ name: customers.name }).from(customers)
	*   );
	* // or
	* import { union } from 'drizzle-orm/mysql-core'
	*
	* await union(
	*   db.select({ name: users.name }).from(users),
	*   db.select({ name: customers.name }).from(customers)
	* );
	* ```
	*/
	union = this.createSetOperator("union", false);
	/**
	* Adds `union all` set operator to the query.
	*
	* Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
	*
	* @example
	*
	* ```ts
	* // Select all transaction ids from both online and in-store sales
	* await db.select({ transaction: onlineSales.transactionId })
	*   .from(onlineSales)
	*   .unionAll(
	*     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
	*   );
	* // or
	* import { unionAll } from 'drizzle-orm/mysql-core'
	*
	* await unionAll(
	*   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
	*   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
	* );
	* ```
	*/
	unionAll = this.createSetOperator("union", true);
	/**
	* Adds `intersect` set operator to the query.
	*
	* Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
	*
	* @example
	*
	* ```ts
	* // Select course names that are offered in both departments A and B
	* await db.select({ courseName: depA.courseName })
	*   .from(depA)
	*   .intersect(
	*     db.select({ courseName: depB.courseName }).from(depB)
	*   );
	* // or
	* import { intersect } from 'drizzle-orm/mysql-core'
	*
	* await intersect(
	*   db.select({ courseName: depA.courseName }).from(depA),
	*   db.select({ courseName: depB.courseName }).from(depB)
	* );
	* ```
	*/
	intersect = this.createSetOperator("intersect", false);
	/**
	* Adds `intersect all` set operator to the query.
	*
	* Calling this method will retain only the rows that are present in both result sets including all duplicates.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect-all}
	*
	* @example
	*
	* ```ts
	* // Select all products and quantities that are ordered by both regular and VIP customers
	* await db.select({
	*   productId: regularCustomerOrders.productId,
	*   quantityOrdered: regularCustomerOrders.quantityOrdered
	* })
	* .from(regularCustomerOrders)
	* .intersectAll(
	*   db.select({
	*     productId: vipCustomerOrders.productId,
	*     quantityOrdered: vipCustomerOrders.quantityOrdered
	*   })
	*   .from(vipCustomerOrders)
	* );
	* // or
	* import { intersectAll } from 'drizzle-orm/mysql-core'
	*
	* await intersectAll(
	*   db.select({
	*     productId: regularCustomerOrders.productId,
	*     quantityOrdered: regularCustomerOrders.quantityOrdered
	*   })
	*   .from(regularCustomerOrders),
	*   db.select({
	*     productId: vipCustomerOrders.productId,
	*     quantityOrdered: vipCustomerOrders.quantityOrdered
	*   })
	*   .from(vipCustomerOrders)
	* );
	* ```
	*/
	intersectAll = this.createSetOperator("intersect", true);
	/**
	* Adds `except` set operator to the query.
	*
	* Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
	*
	* @example
	*
	* ```ts
	* // Select all courses offered in department A but not in department B
	* await db.select({ courseName: depA.courseName })
	*   .from(depA)
	*   .except(
	*     db.select({ courseName: depB.courseName }).from(depB)
	*   );
	* // or
	* import { except } from 'drizzle-orm/mysql-core'
	*
	* await except(
	*   db.select({ courseName: depA.courseName }).from(depA),
	*   db.select({ courseName: depB.courseName }).from(depB)
	* );
	* ```
	*/
	except = this.createSetOperator("except", false);
	/**
	* Adds `except all` set operator to the query.
	*
	* Calling this method will retrieve all rows from the left query, except for the rows that are present in the result set of the right query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#except-all}
	*
	* @example
	*
	* ```ts
	* // Select all products that are ordered by regular customers but not by VIP customers
	* await db.select({
	*   productId: regularCustomerOrders.productId,
	*   quantityOrdered: regularCustomerOrders.quantityOrdered,
	* })
	* .from(regularCustomerOrders)
	* .exceptAll(
	*   db.select({
	*     productId: vipCustomerOrders.productId,
	*     quantityOrdered: vipCustomerOrders.quantityOrdered,
	*   })
	*   .from(vipCustomerOrders)
	* );
	* // or
	* import { exceptAll } from 'drizzle-orm/mysql-core'
	*
	* await exceptAll(
	*   db.select({
	*     productId: regularCustomerOrders.productId,
	*     quantityOrdered: regularCustomerOrders.quantityOrdered
	*   })
	*   .from(regularCustomerOrders),
	*   db.select({
	*     productId: vipCustomerOrders.productId,
	*     quantityOrdered: vipCustomerOrders.quantityOrdered
	*   })
	*   .from(vipCustomerOrders)
	* );
	* ```
	*/
	exceptAll = this.createSetOperator("except", true);
	/** @internal */
	addSetOperators(setOperators) {
		this.config.setOperators.push(...setOperators);
		return this;
	}
	/**
	* Adds a `where` clause to the query.
	*
	* Calling this method will select only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#filtering}
	*
	* @param where the `where` clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be selected.
	*
	* ```ts
	* // Select all cars with green color
	* await db.select().from(cars).where(eq(cars.color, 'green'));
	* // or
	* await db.select().from(cars).where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Select all BMW cars with a green color
	* await db.select().from(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Select all cars with the green or blue color
	* await db.select().from(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		if (typeof where === "function") where = where(new Proxy(this.config.fields, new SelectionProxyHandler({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})));
		this.config.where = where;
		return this;
	}
	/**
	* Adds a `having` clause to the query.
	*
	* Calling this method will select only those rows that fulfill a specified condition. It is typically used with aggregate functions to filter the aggregated data based on a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#aggregations}
	*
	* @param having the `having` clause.
	*
	* @example
	*
	* ```ts
	* // Select all brands with more than one car
	* await db.select({
	* 	brand: cars.brand,
	* 	count: sql<number>`cast(count(${cars.id}) as int)`,
	* })
	*   .from(cars)
	*   .groupBy(cars.brand)
	*   .having(({ count }) => gt(count, 1));
	* ```
	*/
	having(having) {
		if (typeof having === "function") having = having(new Proxy(this.config.fields, new SelectionProxyHandler({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})));
		this.config.having = having;
		return this;
	}
	groupBy(...columns) {
		if (typeof columns[0] === "function") {
			const groupBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			this.config.groupBy = Array.isArray(groupBy) ? groupBy : [groupBy];
		} else this.config.groupBy = columns;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
			else this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
			else this.config.orderBy = orderByArray;
		}
		return this;
	}
	/**
	* Adds a `limit` clause to the query.
	*
	* Calling this method will set the maximum number of rows that will be returned by this query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
	*
	* @param limit the `limit` clause.
	*
	* @example
	*
	* ```ts
	* // Get the first 10 people from this query.
	* await db.select().from(people).limit(10);
	* ```
	*/
	limit(limit) {
		if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).limit = limit;
		else this.config.limit = limit;
		return this;
	}
	/**
	* Adds an `offset` clause to the query.
	*
	* Calling this method will skip a number of rows when returning results from this query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
	*
	* @param offset the `offset` clause.
	*
	* @example
	*
	* ```ts
	* // Get the 10th-20th people from this query.
	* await db.select().from(people).offset(10).limit(10);
	* ```
	*/
	offset(offset) {
		if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).offset = offset;
		else this.config.offset = offset;
		return this;
	}
	/**
	* Adds a `for` clause to the query.
	*
	* Calling this method will specify a lock strength for this query that controls how strictly it acquires exclusive access to the rows being queried.
	*
	* See docs: {@link https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html}
	*
	* @param strength the lock strength.
	* @param config the lock configuration.
	*/
	for(strength, config = {}) {
		this.config.lockingClause = {
			strength,
			config
		};
		return this;
	}
	/**
	* Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
	*/
	comment(comment) {
		this.config.comment = sql$1.comment(comment);
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildSelectQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	as(alias) {
		const usedTables = [];
		usedTables.push(...extractUsedTable$2(this.config.table));
		if (this.config.joins) for (const it of this.config.joins) usedTables.push(...extractUsedTable$2(it.table));
		return new Proxy(new Subquery(this.getSQL(), this.config.fields, alias, false, [...new Set(usedTables)]), new SelectionProxyHandler({
			alias,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	/** @internal */
	getSelectedFields() {
		return new Proxy(this.config.fields, new SelectionProxyHandler({
			alias: this.tableName,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		return this;
	}
	$dynamic() {
		return this;
	}
	$withCache(config) {
		this.cacheConfig = config === void 0 ? {
			config: {},
			enabled: true,
			autoInvalidate: true
		} : config === false ? { enabled: false } : {
			enabled: true,
			autoInvalidate: true,
			...config
		};
		return this;
	}
};
var MySqlSelectBase = class extends MySqlSelectQueryBuilderBase {
	static [entityKind] = "MySqlSelect";
	prepare() {
		if (!this.session) throw new Error("Cannot execute a query on a query builder. Please use a database instance instead.");
		const query = this.dialect.sqlToQuery(this.getSQL());
		const fieldsList = orderSelectedFields(this.config.fields);
		const mapper = this.dialect.mapperGenerators.rows(fieldsList, this.joinsNotNullableMap);
		return this.session.prepareQuery(query, "arrays", mapper, {
			type: "select",
			tables: [...this.usedTables]
		}, this.cacheConfig);
	}
	execute = ((placeholderValues) => {
		return this.prepare().execute(placeholderValues);
	});
	createIterator = () => {
		const self = this;
		return async function* (placeholderValues) {
			yield* self.prepare().iterator(placeholderValues);
		};
	};
	iterator = this.createIterator();
};
applyMixins(MySqlSelectBase, [QueryPromise]);
function createSetOperator$2(type, isAll) {
	return (leftSelect, rightSelect, ...restSelects) => {
		const setOperators = [rightSelect, ...restSelects].map((select) => ({
			type,
			isAll,
			rightSelect: select
		}));
		for (const setOperator of setOperators) if (!haveSameKeys(leftSelect.getSelectedFields(), setOperator.rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
		return leftSelect.addSetOperators(setOperators);
	};
}
var getMySqlSetOperators = () => ({
	union: union$2,
	unionAll: unionAll$2,
	intersect: intersect$2,
	intersectAll: intersectAll$1,
	except: except$2,
	exceptAll: exceptAll$1
});
/**
* Adds `union` set operator to the query.
*
* Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
*
* @example
*
* ```ts
* // Select all unique names from customers and users tables
* import { union } from 'drizzle-orm/mysql-core'
*
* await union(
*   db.select({ name: users.name }).from(users),
*   db.select({ name: customers.name }).from(customers)
* );
* // or
* await db.select({ name: users.name })
*   .from(users)
*   .union(
*     db.select({ name: customers.name }).from(customers)
*   );
* ```
*/
var union$2 = createSetOperator$2("union", false);
/**
* Adds `union all` set operator to the query.
*
* Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
*
* @example
*
* ```ts
* // Select all transaction ids from both online and in-store sales
* import { unionAll } from 'drizzle-orm/mysql-core'
*
* await unionAll(
*   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
*   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
* );
* // or
* await db.select({ transaction: onlineSales.transactionId })
*   .from(onlineSales)
*   .unionAll(
*     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
*   );
* ```
*/
var unionAll$2 = createSetOperator$2("union", true);
/**
* Adds `intersect` set operator to the query.
*
* Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
*
* @example
*
* ```ts
* // Select course names that are offered in both departments A and B
* import { intersect } from 'drizzle-orm/mysql-core'
*
* await intersect(
*   db.select({ courseName: depA.courseName }).from(depA),
*   db.select({ courseName: depB.courseName }).from(depB)
* );
* // or
* await db.select({ courseName: depA.courseName })
*   .from(depA)
*   .intersect(
*     db.select({ courseName: depB.courseName }).from(depB)
*   );
* ```
*/
var intersect$2 = createSetOperator$2("intersect", false);
/**
* Adds `intersect all` set operator to the query.
*
* Calling this method will retain only the rows that are present in both result sets including all duplicates.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect-all}
*
* @example
*
* ```ts
* // Select all products and quantities that are ordered by both regular and VIP customers
* import { intersectAll } from 'drizzle-orm/mysql-core'
*
* await intersectAll(
*   db.select({
*     productId: regularCustomerOrders.productId,
*     quantityOrdered: regularCustomerOrders.quantityOrdered
*   })
*   .from(regularCustomerOrders),
*   db.select({
*     productId: vipCustomerOrders.productId,
*     quantityOrdered: vipCustomerOrders.quantityOrdered
*   })
*   .from(vipCustomerOrders)
* );
* // or
* await db.select({
*   productId: regularCustomerOrders.productId,
*   quantityOrdered: regularCustomerOrders.quantityOrdered
* })
* .from(regularCustomerOrders)
* .intersectAll(
*   db.select({
*     productId: vipCustomerOrders.productId,
*     quantityOrdered: vipCustomerOrders.quantityOrdered
*   })
*   .from(vipCustomerOrders)
* );
* ```
*/
var intersectAll$1 = createSetOperator$2("intersect", true);
/**
* Adds `except` set operator to the query.
*
* Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
*
* @example
*
* ```ts
* // Select all courses offered in department A but not in department B
* import { except } from 'drizzle-orm/mysql-core'
*
* await except(
*   db.select({ courseName: depA.courseName }).from(depA),
*   db.select({ courseName: depB.courseName }).from(depB)
* );
* // or
* await db.select({ courseName: depA.courseName })
*   .from(depA)
*   .except(
*     db.select({ courseName: depB.courseName }).from(depB)
*   );
* ```
*/
var except$2 = createSetOperator$2("except", false);
/**
* Adds `except all` set operator to the query.
*
* Calling this method will retrieve all rows from the left query, except for the rows that are present in the result set of the right query.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#except-all}
*
* @example
*
* ```ts
* // Select all products that are ordered by regular customers but not by VIP customers
* import { exceptAll } from 'drizzle-orm/mysql-core'
*
* await exceptAll(
*   db.select({
*     productId: regularCustomerOrders.productId,
*     quantityOrdered: regularCustomerOrders.quantityOrdered
*   })
*   .from(regularCustomerOrders),
*   db.select({
*     productId: vipCustomerOrders.productId,
*     quantityOrdered: vipCustomerOrders.quantityOrdered
*   })
*   .from(vipCustomerOrders)
* );
* // or
* await db.select({
*   productId: regularCustomerOrders.productId,
*   quantityOrdered: regularCustomerOrders.quantityOrdered,
* })
* .from(regularCustomerOrders)
* .exceptAll(
*   db.select({
*     productId: vipCustomerOrders.productId,
*     quantityOrdered: vipCustomerOrders.quantityOrdered,
*   })
*   .from(vipCustomerOrders)
* );
* ```
*/
var exceptAll$1 = createSetOperator$2("except", true);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/errors.js
var DrizzleError = class extends Error {
	static [entityKind] = "DrizzleError";
	constructor({ message, cause }) {
		super(message);
		this.name = "DrizzleError";
		this.cause = cause;
	}
};
var DrizzleQueryError = class DrizzleQueryError extends Error {
	static [entityKind] = "DrizzleQueryError";
	constructor(query, params, cause) {
		super(`Failed query: ${query}\nparams: ${params}`);
		this.query = query;
		this.params = params;
		this.cause = cause;
		this.name = "DrizzleQueryError";
		Error.captureStackTrace(this, DrizzleQueryError);
		if (cause) this.cause = cause;
	}
};
var TransactionRollbackError = class extends DrizzleError {
	static [entityKind] = "TransactionRollbackError";
	constructor() {
		super({ message: "Rollback" });
		this.name = "TransactionRollbackError";
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sql/expressions/conditions.js
function bindIfParam(value, column) {
	if (isDriverValueEncoder(column) && !isSQLWrapper(value) && !is(value, Param) && !is(value, Placeholder) && !is(value, Column) && !is(value, Table) && !is(value, View)) return new Param(value, column);
	return value;
}
/**
* Test that two values are equal.
*
* Remember that the SQL standard dictates that
* two NULL values are not equal, so if you want to test
* whether a value is null, you may want to use
* `isNull` instead.
*
* ## Examples
*
* ```ts
* // Select cars made by Ford
* db.select().from(cars)
*   .where(eq(cars.make, 'Ford'))
* ```
*
* @see isNull for a way to test equality to NULL.
*/
var eq = (left, right) => {
	return sql$1`${left} = ${bindIfParam(right, left)}`;
};
/**
* Test that two values are not equal.
*
* Remember that the SQL standard dictates that
* two NULL values are not equal, so if you want to test
* whether a value is not null, you may want to use
* `isNotNull` instead.
*
* ## Examples
*
* ```ts
* // Select cars not made by Ford
* db.select().from(cars)
*   .where(ne(cars.make, 'Ford'))
* ```
*
* @see isNotNull for a way to test whether a value is not null.
*/
var ne = (left, right) => {
	return sql$1`${left} <> ${bindIfParam(right, left)}`;
};
function and(...unfilteredConditions) {
	const conditions = unfilteredConditions.filter((c) => c !== void 0);
	if (conditions.length === 0) return;
	if (conditions.length === 1) return new SQL$1(conditions);
	return new SQL$1([
		new StringChunk("("),
		sql$1.join(conditions.map((c) => sql$1`(${c})`), new StringChunk(" and ")),
		new StringChunk(")")
	]);
}
function or(...unfilteredConditions) {
	const conditions = unfilteredConditions.filter((c) => c !== void 0);
	if (conditions.length === 0) return;
	if (conditions.length === 1) return new SQL$1(conditions);
	return new SQL$1([
		new StringChunk("("),
		sql$1.join(conditions.map((c) => sql$1`(${c})`), new StringChunk(" or ")),
		new StringChunk(")")
	]);
}
/**
* Negate the meaning of an expression using the `not` keyword.
*
* ## Examples
*
* ```ts
* // Select cars _not_ made by GM or Ford.
* db.select().from(cars)
*   .where(not(inArray(cars.make, ['GM', 'Ford'])))
* ```
*/
function not(condition) {
	return is(condition, SQL$1) ? sql$1`not (${condition})` : sql$1`not ${condition}`;
}
/**
* Test that the first expression passed is greater than
* the second expression.
*
* ## Examples
*
* ```ts
* // Select cars made after 2000.
* db.select().from(cars)
*   .where(gt(cars.year, 2000))
* ```
*
* @see gte for greater-than-or-equal
*/
var gt = (left, right) => {
	return sql$1`${left} > ${bindIfParam(right, left)}`;
};
/**
* Test that the first expression passed is greater than
* or equal to the second expression. Use `gt` to
* test whether an expression is strictly greater
* than another.
*
* ## Examples
*
* ```ts
* // Select cars made on or after 2000.
* db.select().from(cars)
*   .where(gte(cars.year, 2000))
* ```
*
* @see gt for a strictly greater-than condition
*/
var gte = (left, right) => {
	return sql$1`${left} >= ${bindIfParam(right, left)}`;
};
/**
* Test that the first expression passed is less than
* the second expression.
*
* ## Examples
*
* ```ts
* // Select cars made before 2000.
* db.select().from(cars)
*   .where(lt(cars.year, 2000))
* ```
*
* @see lte for less-than-or-equal
*/
var lt = (left, right) => {
	return sql$1`${left} < ${bindIfParam(right, left)}`;
};
/**
* Test that the first expression passed is less than
* or equal to the second expression.
*
* ## Examples
*
* ```ts
* // Select cars made before 2000.
* db.select().from(cars)
*   .where(lte(cars.year, 2000))
* ```
*
* @see lt for a strictly less-than condition
*/
var lte = (left, right) => {
	return sql$1`${left} <= ${bindIfParam(right, left)}`;
};
function inArray(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) return sql$1`false`;
		return sql$1`${column} in ${values.map((v) => bindIfParam(v, column))}`;
	}
	return sql$1`${column} in ${bindIfParam(values, column)}`;
}
function notInArray(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) return sql$1`true`;
		return sql$1`${column} not in ${values.map((v) => bindIfParam(v, column))}`;
	}
	return sql$1`${column} not in ${bindIfParam(values, column)}`;
}
/**
* Test whether an expression is NULL. By the SQL standard,
* NULL is neither equal nor not equal to itself, so
* it's recommended to use `isNull` and `notIsNull` for
* comparisons to NULL.
*
* ## Examples
*
* ```ts
* // Select cars that have no discontinuedAt date.
* db.select().from(cars)
*   .where(isNull(cars.discontinuedAt))
* ```
*
* @see isNotNull for the inverse of this test
*/
function isNull(value) {
	return sql$1`(${value} is null)`;
}
/**
* Test whether an expression is not NULL. By the SQL standard,
* NULL is neither equal nor not equal to itself, so
* it's recommended to use `isNull` and `notIsNull` for
* comparisons to NULL.
*
* ## Examples
*
* ```ts
* // Select cars that have been discontinued.
* db.select().from(cars)
*   .where(isNotNull(cars.discontinuedAt))
* ```
*
* @see isNull for the inverse of this test
*/
function isNotNull(value) {
	return sql$1`(${value} is not null)`;
}
/**
* Test whether a subquery evaluates to have any rows.
*
* ## Examples
*
* ```ts
* // Users whose `homeCity` column has a match in a cities
* // table.
* db
*   .select()
*   .from(users)
*   .where(
*     exists(db.select()
*       .from(cities)
*       .where(eq(users.homeCity, cities.id))),
*   );
* ```
*
* @see notExists for the inverse of this test
*/
function exists(subquery) {
	return sql$1`exists ${subquery}`;
}
/**
* Test whether a subquery doesn't include any result
* rows.
*
* ## Examples
*
* ```ts
* // Users whose `homeCity` column doesn't match
* // a row in the cities table.
* db
*   .select()
*   .from(users)
*   .where(
*     notExists(db.select()
*       .from(cities)
*       .where(eq(users.homeCity, cities.id))),
*   );
* ```
*
* @see exists for the inverse of this test
*/
function notExists(subquery) {
	return sql$1`not exists ${subquery}`;
}
function between(column, min, max) {
	return sql$1`${column} between ${bindIfParam(min, column)} and ${bindIfParam(max, column)}`;
}
function notBetween(column, min, max) {
	return sql$1`${column} not between ${bindIfParam(min, column)} and ${bindIfParam(max, column)}`;
}
/**
* Compare a column to a pattern, which can include `%` and `_`
* characters to match multiple variations. Including `%`
* in the pattern matches zero or more characters, and including
* `_` will match a single character.
*
* ## Examples
*
* ```ts
* // Select all cars with 'Turbo' in their names.
* db.select().from(cars)
*   .where(like(cars.name, '%Turbo%'))
* ```
*
* @see ilike for a case-insensitive version of this condition
*/
function like(column, value) {
	return sql$1`${column} like ${value}`;
}
/**
* The inverse of like - this tests that a given column
* does not match a pattern, which can include `%` and `_`
* characters to match multiple variations. Including `%`
* in the pattern matches zero or more characters, and including
* `_` will match a single character.
*
* ## Examples
*
* ```ts
* // Select all cars that don't have "ROver" in their name.
* db.select().from(cars)
*   .where(notLike(cars.name, '%Rover%'))
* ```
*
* @see like for the inverse condition
* @see notIlike for a case-insensitive version of this condition
*/
function notLike(column, value) {
	return sql$1`${column} not like ${value}`;
}
/**
* Case-insensitively compare a column to a pattern,
* which can include `%` and `_`
* characters to match multiple variations. Including `%`
* in the pattern matches zero or more characters, and including
* `_` will match a single character.
*
* Unlike like, this performs a case-insensitive comparison.
*
* ## Examples
*
* ```ts
* // Select all cars with 'Turbo' in their names.
* db.select().from(cars)
*   .where(ilike(cars.name, '%Turbo%'))
* ```
*
* @see like for a case-sensitive version of this condition
*/
function ilike(column, value) {
	return sql$1`${column} ilike ${value}`;
}
/**
* The inverse of ilike - this case-insensitively tests that a given column
* does not match a pattern, which can include `%` and `_`
* characters to match multiple variations. Including `%`
* in the pattern matches zero or more characters, and including
* `_` will match a single character.
*
* ## Examples
*
* ```ts
* // Select all cars that don't have "Rover" in their name.
* db.select().from(cars)
*   .where(notLike(cars.name, '%Rover%'))
* ```
*
* @see ilike for the inverse condition
* @see notLike for a case-sensitive version of this condition
*/
function notIlike(column, value) {
	return sql$1`${column} not ilike ${value}`;
}
function arrayContains(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) throw new Error("arrayContains requires at least one value");
		const par = bindIfParam(values, column);
		return sql$1`${column} @> ${sql$1`${Array.isArray(par) ? new Param(par) : par}`}`;
	}
	return sql$1`${column} @> ${bindIfParam(values, column)}`;
}
function arrayContained(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) throw new Error("arrayContained requires at least one value");
		const par = bindIfParam(values, column);
		return sql$1`${column} <@ ${sql$1`${Array.isArray(par) ? new Param(par) : par}`}`;
	}
	return sql$1`${column} <@ ${bindIfParam(values, column)}`;
}
function arrayOverlaps(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) throw new Error("arrayOverlaps requires at least one value");
		const par = bindIfParam(values, column);
		return sql$1`${column} && ${sql$1`${Array.isArray(par) ? new Param(par) : par}`}`;
	}
	return sql$1`${column} && ${bindIfParam(values, column)}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sql/expressions/select.js
/**
* Used in sorting, this specifies that the given
* column or expression should be sorted in ascending
* order. By the SQL standard, ascending order is the
* default, so it is not usually necessary to specify
* ascending sort order.
*
* ## Examples
*
* ```ts
* // Return cars, starting with the oldest models
* // and going in ascending order to the newest.
* db.select().from(cars)
*   .orderBy(asc(cars.year));
* ```
*
* @see desc to sort in descending order
*/
function asc(column) {
	return sql$1`${column} asc`;
}
/**
* Used in sorting, this specifies that the given
* column or expression should be sorted in descending
* order.
*
* ## Examples
*
* ```ts
* // Select users, with the most recently created
* // records coming first.
* db.select().from(users)
*   .orderBy(desc(users.createdAt));
* ```
*
* @see asc to sort in ascending order
*/
function desc(column) {
	return sql$1`${column} desc`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/relations.js
var Relation$1 = class {
	static [entityKind] = "RelationV2";
	fieldName;
	sourceColumns;
	targetColumns;
	alias;
	where;
	sourceTable;
	targetTable;
	through;
	throughTable;
	isReversed;
	/** @internal */
	sourceColumnTableNames = [];
	/** @internal */
	targetColumnTableNames = [];
	constructor(targetTable, targetTableName) {
		this.targetTableName = targetTableName;
		this.targetTable = targetTable;
	}
};
var One$1 = class extends Relation$1 {
	static [entityKind] = "OneV2";
	relationType = "one";
	optional;
	constructor(tables, targetTable, targetTableName, config) {
		super(targetTable, targetTableName);
		this.alias = config?.alias;
		this.where = config?.where;
		if (config?.from) this.sourceColumns = (Array.isArray(config.from) ? config.from : [config.from]).map((it) => {
			this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
			this.sourceColumnTableNames.push(it._.tableName);
			return it._.column;
		});
		if (config?.to) this.targetColumns = (Array.isArray(config.to) ? config.to : [config.to]).map((it) => {
			this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
			this.targetColumnTableNames.push(it._.tableName);
			return it._.column;
		});
		if (this.throughTable) this.through = {
			source: (Array.isArray(config?.from) ? config.from : config?.from ? [config.from] : []).map((c) => c._.through),
			target: (Array.isArray(config?.to) ? config.to : config?.to ? [config.to] : []).map((c) => c._.through)
		};
		this.optional = config?.optional ?? true;
	}
};
var operators = {
	and,
	between,
	eq,
	exists,
	gt,
	gte,
	ilike,
	inArray,
	arrayContains,
	arrayContained,
	arrayOverlaps,
	isNull,
	isNotNull,
	like,
	lt,
	lte,
	ne,
	not,
	notBetween,
	notExists,
	notLike,
	notIlike,
	notInArray,
	or,
	sql: sql$1
};
var orderByOperators = {
	sql: sql$1,
	asc,
	desc
};
function mapRelationalRow$1(rows, isOne, buildQueryResultSelection, mapColumnValue, parseJson = false, parseJsonIfString = false, useJsonMappers = true) {
	const maxIdx = isOne ? 1 : rows.length;
	const decoders = buildQueryResultSelection.map(({ field, codec, arrayDimensions }) => {
		let decoder;
		if (is(field, Column)) decoder = field;
		else if (is(field, SQL$1)) decoder = field.decoder;
		else if (is(field, SQL$1.Aliased)) decoder = field.sql.decoder;
		else if (is(field, Table) || is(field, View)) decoder = noopDecoder;
		else decoder = field.getSQL().decoder;
		if (useJsonMappers && field.mapFromJsonValue) return (v) => field.mapFromJsonValue(v);
		return decoder.mapFromDriverValue.isNoop ? codec ? (value) => codec(value, arrayDimensions) : void 0 : codec ? (value) => decoder.mapFromDriverValue(codec(value, arrayDimensions)) : (value) => decoder.mapFromDriverValue(value);
	});
	for (let i = 0; i < maxIdx; ++i) {
		const row = isOne ? rows : rows[i];
		for (let selectionItemIdx = 0; selectionItemIdx < buildQueryResultSelection.length; ++selectionItemIdx) {
			const selectionItem = buildQueryResultSelection[selectionItemIdx];
			if (selectionItem.selection) {
				if (row[selectionItem.key] === null) continue;
				if (parseJson) {
					row[selectionItem.key] = JSON.parse(row[selectionItem.key]);
					if (row[selectionItem.key] === null) continue;
				} else if (parseJsonIfString && typeof row[selectionItem.key] === "string") row[selectionItem.key] = JSON.parse(row[selectionItem.key]);
				if (selectionItem.isArray) {
					mapRelationalRow$1(row[selectionItem.key], false, selectionItem.selection, mapColumnValue, false, parseJsonIfString);
					continue;
				}
				mapRelationalRow$1(row[selectionItem.key], true, selectionItem.selection, mapColumnValue, false, parseJsonIfString);
				continue;
			}
			if (mapColumnValue) row[selectionItem.key] = mapColumnValue(row[selectionItem.key]);
			if (row[selectionItem.key] === null) continue;
			const decoder = decoders[selectionItemIdx];
			if (!decoder) continue;
			row[selectionItem.key] = decoder(row[selectionItem.key]);
		}
	}
	return rows;
}
function mapRelationalRowFromArrays(rows, isOne, buildQueryResultSelection, mapColumnValue, parseJson = false, parseJsonIfString = false) {
	const maxIdx = isOne ? 1 : rows.length;
	const decoders = buildQueryResultSelection.map(({ field, codec, arrayDimensions }) => {
		let decoder;
		if (is(field, Column)) decoder = field;
		else if (is(field, SQL$1)) decoder = field.decoder;
		else if (is(field, SQL$1.Aliased)) decoder = field.sql.decoder;
		else if (is(field, Table) || is(field, View)) decoder = noopDecoder;
		else decoder = field.getSQL().decoder;
		return decoder.mapFromDriverValue.isNoop ? codec ? (value) => codec(value, arrayDimensions) : void 0 : codec ? (value) => decoder.mapFromDriverValue(codec(value, arrayDimensions)) : (value) => decoder.mapFromDriverValue(value);
	});
	const results = Array.from({ length: maxIdx });
	for (let i = 0; i < maxIdx; ++i) {
		const row = isOne ? rows : rows[i];
		const result = {};
		for (let selectionItemIdx = 0; selectionItemIdx < buildQueryResultSelection.length; ++selectionItemIdx) {
			const selectionItem = buildQueryResultSelection[selectionItemIdx];
			let value = row[selectionItemIdx];
			if (selectionItem.selection) {
				if (value === null) {
					result[selectionItem.key] = null;
					continue;
				}
				if (parseJson) {
					value = JSON.parse(value);
					if (value === null) {
						result[selectionItem.key] = null;
						continue;
					}
				} else if (parseJsonIfString && typeof value === "string") value = JSON.parse(value);
				if (selectionItem.isArray) mapRelationalRow$1(value, false, selectionItem.selection, mapColumnValue, false, parseJsonIfString);
				else mapRelationalRow$1(value, true, selectionItem.selection, mapColumnValue, false, parseJsonIfString);
				result[selectionItem.key] = value;
				continue;
			}
			if (mapColumnValue) value = mapColumnValue(value);
			if (value === null) {
				result[selectionItem.key] = null;
				continue;
			}
			const decoder = decoders[selectionItemIdx];
			result[selectionItem.key] = decoder ? decoder(value) : value;
		}
		results[i] = result;
	}
	return isOne ? results[0] : results;
}
function makeDefaultRqbMapper({ selection, isFirst, parseJson, parseJsonIfString, rootJsonMappers, arrayModeRoot }, mapColumnValue) {
	return ((rows) => {
		if (isFirst && !rows[0]) return rows[0];
		return arrayModeRoot ? mapRelationalRowFromArrays(isFirst ? rows[0] : rows, isFirst, selection, mapColumnValue, parseJson, parseJsonIfString) : mapRelationalRow$1(isFirst ? rows[0] : rows, isFirst, selection, mapColumnValue, parseJson, parseJsonIfString, rootJsonMappers);
	});
}
function makeJitRqbMapperInner(selection, rowExpr, selectionVar, mapColumnValue, parseJson, parseJsonIfString, useJsonMappers, preFn, counter, accessByIdx) {
	const bodyStmts = [];
	const literalEntries = [];
	let hasWork = false;
	const fieldVars = selection.map(() => `c${counter.n++}`);
	const destructurePieces = selection.map((item, idx) => accessByIdx ? fieldVars[idx] : `${JSON.stringify(item.key)}: ${fieldVars[idx]}`);
	bodyStmts.push(accessByIdx ? `let [ ${destructurePieces.join(", ")} ] = ${rowExpr};` : `let { ${destructurePieces.join(", ")} } = ${rowExpr};`);
	for (const [idx, { field, key, codec, isArray, selection: innerSelection, arrayDimensions }] of selection.entries()) {
		const sel = `${selectionVar}[${idx}]`;
		const keyStr = JSON.stringify(key);
		const slot = fieldVars[idx];
		if (innerSelection) {
			if (parseJson) {
				bodyStmts.push(`if (${slot} !== null) ${slot} = JSON.parse(${slot});`);
				hasWork = true;
			} else if (parseJsonIfString) {
				bodyStmts.push(`if (typeof ${slot} === 'string') ${slot} = JSON.parse(${slot});`);
				hasWork = true;
			}
			const nestedSelVar = `s${counter.n++}`;
			const savedPreFnLen = preFn.length;
			preFn.push(`const { selection: ${nestedSelVar} } = ${sel};`);
			if (isArray) {
				const j = `j${counter.n++}`;
				const inner = makeJitRqbMapperInner(innerSelection, `${slot}[${j}]`, nestedSelVar, mapColumnValue, false, parseJsonIfString, true, preFn, counter, false);
				if (inner.hasWork) {
					hasWork = true;
					bodyStmts.push(`if (${slot} !== null) {`);
					bodyStmts.push(`\tfor (let ${j} = 0; ${j} < ${slot}.length; ++${j}) {`);
					for (const s of inner.bodyStmts) bodyStmts.push(`\t\t${s}`);
					bodyStmts.push(`\t\t${slot}[${j}] = ${inner.literal};`);
					bodyStmts.push(`\t}`);
					bodyStmts.push(`}`);
				} else preFn.splice(savedPreFnLen, 1);
			} else {
				const inner = makeJitRqbMapperInner(innerSelection, slot, nestedSelVar, mapColumnValue, false, parseJsonIfString, true, preFn, counter, false);
				if (inner.hasWork) {
					hasWork = true;
					bodyStmts.push(`if (${slot} !== null) {`);
					for (const s of inner.bodyStmts) bodyStmts.push(`\t${s}`);
					bodyStmts.push(`\t${slot} = ${inner.literal};`);
					bodyStmts.push(`}`);
				} else preFn.splice(savedPreFnLen, 1);
			}
			literalEntries.push(`${keyStr}: ${slot}`);
			continue;
		}
		let decoderExpr = "";
		let destructure = "";
		let bypassCodecs = false;
		if (is(field, Column)) {
			if (useJsonMappers && field.mapFromJsonValue) {
				bypassCodecs = true;
				const id = counter.n++;
				destructure = `field: dec${id}`;
				decoderExpr = `dec${id}.mapFromJsonValue`;
			} else if (!field.mapFromDriverValue.isNoop) {
				const id = counter.n++;
				destructure = `field: dec${id}`;
				decoderExpr = `dec${id}.mapFromDriverValue`;
			}
		} else if (is(field, SQL$1)) {
			if (useJsonMappers && field.decoder.mapFromJsonValue) {
				bypassCodecs = true;
				const id = counter.n++;
				destructure = `field: { decoder: dec${id} }`;
				decoderExpr = `dec${id}.mapFromJsonValue`;
			} else if (!field.decoder.mapFromDriverValue.isNoop) {
				const id = counter.n++;
				destructure = `field: { decoder: dec${id} }`;
				decoderExpr = `dec${id}.mapFromDriverValue`;
			}
		} else if (is(field, SQL$1.Aliased)) {
			if (useJsonMappers && field.sql.decoder.mapFromJsonValue) {
				bypassCodecs = true;
				const id = counter.n++;
				destructure = `field: { sql: { decoder: dec${id} } }`;
				decoderExpr = `dec${id}.mapFromJsonValue`;
			} else if (!field.sql.decoder.mapFromDriverValue.isNoop) {
				const id = counter.n++;
				destructure = `field: { sql: { decoder: dec${id} } }`;
				decoderExpr = `dec${id}.mapFromDriverValue`;
			}
		} else if (is(field, Table) || is(field, View)) {} else {
			const sqlExpr = field.getSQL();
			if (useJsonMappers && sqlExpr.decoder.mapFromJsonValue) {
				bypassCodecs = true;
				const id = counter.n++;
				preFn.push(`const dec${id} = ${sel}.field.getSQL().decoder;`);
				decoderExpr = `dec${id}.mapFromJsonValue`;
			} else if (!sqlExpr.decoder.mapFromDriverValue.isNoop) {
				const id = counter.n++;
				preFn.push(`const dec${id} = ${sel}.field.getSQL().decoder;`);
				decoderExpr = `dec${id}.mapFromDriverValue`;
			}
		}
		let codecVar = "";
		if (!bypassCodecs && codec) codecVar = `codec${counter.n++}`;
		if (destructure || codecVar) {
			const parts = [];
			if (destructure) parts.push(destructure);
			if (codecVar) parts.push(`codec: ${codecVar}`);
			preFn.push(`const { ${parts.join(", ")} } = ${sel};`);
		}
		if (mapColumnValue) {
			hasWork = true;
			bodyStmts.push(`${slot} = mapColumnValue(${slot});`);
			if (decoderExpr || codecVar) {
				let decoded = slot;
				if (codecVar) decoded = `${codecVar}(${decoded}, ${arrayDimensions})`;
				if (decoderExpr) decoded = `${decoderExpr}(${decoded})`;
				bodyStmts.push(`if (${slot} !== null) ${slot} = ${decoded};`);
			}
			literalEntries.push(`${keyStr}: ${slot}`);
		} else if (decoderExpr || codecVar) {
			hasWork = true;
			let decoded = slot;
			if (codecVar) decoded = `${codecVar}(${decoded}, ${arrayDimensions})`;
			if (decoderExpr) decoded = `${decoderExpr}(${decoded})`;
			literalEntries.push(`${keyStr}: ${slot} === null ? null : ${decoded}`);
		} else literalEntries.push(`${keyStr}: ${slot}`);
	}
	return {
		bodyStmts,
		literal: `{ ${literalEntries.join(", ")} }`,
		hasWork
	};
}
function makeJitRqbMapper({ selection, isFirst, parseJson, parseJsonIfString, rootJsonMappers, arrayModeRoot }, mapColumnValue) {
	const preFn = [];
	const inner = makeJitRqbMapperInner(selection, "row", "selection", mapColumnValue, parseJson, parseJsonIfString, arrayModeRoot ? false : rootJsonMappers, preFn, { n: 0 }, !!arrayModeRoot);
	const lines = [];
	lines.push(`\t"use strict";
	const { selection${mapColumnValue ? `, mapColumnValue` : ""} } = this;`);
	for (const p of preFn) lines.push(`\t${p}`);
	if (arrayModeRoot) if (isFirst) {
		lines.push(`\tconst row = rows[0];`);
		lines.push(`\tif (!row) return undefined;`);
		for (const s of inner.bodyStmts) lines.push(`\t${s}`);
		lines.push(`\treturn ${inner.literal};`);
	} else {
		lines.push(`\tconst { length } = rows;`);
		lines.push(`\tconst mapped = Array.from({ length });`);
		lines.push(`\tfor (let i = 0; i < length; ++i) {`);
		lines.push(`\t\tconst row = rows[i];`);
		for (const s of inner.bodyStmts) lines.push(`\t\t${s}`);
		lines.push(`\t\tmapped[i] = ${inner.literal};`);
		lines.push(`\t}`);
		lines.push(`\treturn mapped;`);
	}
	else if (!inner.hasWork) lines.push(isFirst ? `\treturn rows[0];` : `\treturn rows;`);
	else if (isFirst) {
		lines.push(`\tconst row = rows[0];`);
		lines.push(`\tif (!row) return undefined;`);
		for (const s of inner.bodyStmts) lines.push(`\t${s}`);
		lines.push(`\trows[0] = ${inner.literal};`);
		lines.push(`\treturn rows[0];`);
	} else {
		lines.push(`\tfor (let i = 0; i < rows.length; ++i) {`);
		lines.push(`\t\tconst row = rows[i];`);
		for (const s of inner.bodyStmts) lines.push(`\t\t${s}`);
		lines.push(`\t\trows[i] = ${inner.literal};`);
		lines.push(`\t}`);
		lines.push(`\treturn rows;`);
	}
	lines.push("	//# sourceURL=drizzle:jit-relational-query-mapper");
	const compiled = lines.join("\n");
	return Object.assign(new FnConstructor("rows", compiled).bind({
		selection,
		mapColumnValue
	}), { body: `function jitRqbMapper (rows) {\n${compiled}\n}` });
}
/** @internal */
function fieldSelectionToSQL(table, target) {
	const field = table[TableColumns][target];
	return field ? is(field, Column) ? field : is(field, SQL$1.Aliased) ? sql$1`${table}.${sql$1.identifier(field.fieldAlias)}` : sql$1`${table}.${sql$1.identifier(target)}` : sql$1`${table}.${sql$1.identifier(target)}`;
}
function relationsFieldFilterToSQL(column, filter) {
	if (typeof filter !== "object" || is(filter, Placeholder)) return eq(column, filter);
	const entries = Object.entries(filter);
	if (!entries.length) return void 0;
	const parts = [];
	for (const [target, value] of entries) {
		if (value === void 0) continue;
		switch (target) {
			case "NOT": {
				const res = relationsFieldFilterToSQL(column, value);
				if (!res) continue;
				parts.push(not(res));
				continue;
			}
			case "OR":
				if (!value.length) continue;
				parts.push(or(...value.map((subFilter) => relationsFieldFilterToSQL(column, subFilter))));
				continue;
			case "AND":
				if (!value.length) continue;
				parts.push(and(...value.map((subFilter) => relationsFieldFilterToSQL(column, subFilter))));
				continue;
			case "isNotNull":
			case "isNull":
				if (!value) continue;
				parts.push(operators[target](column));
				continue;
			case "in":
				parts.push(operators.inArray(column, value));
				continue;
			case "notIn":
				parts.push(operators.notInArray(column, value));
				continue;
			default:
				parts.push(operators[target](column, value));
				continue;
		}
	}
	if (!parts.length) return void 0;
	return and(...parts);
}
function relationsFilterToSQL(table, filter, tableRelations = {}, tablesRelations = {}, depth = 0) {
	const entries = Object.entries(filter);
	if (!entries.length) return void 0;
	const parts = [];
	for (const [target, value] of entries) {
		if (value === void 0) continue;
		switch (target) {
			case "RAW": {
				const processed = typeof value === "function" ? value(table, operators) : value.getSQL();
				parts.push(processed);
				continue;
			}
			case "OR":
				if (!value?.length) continue;
				parts.push(or(...value.map((subFilter) => relationsFilterToSQL(table, subFilter, tableRelations, tablesRelations, depth))));
				continue;
			case "AND":
				if (!value?.length) continue;
				parts.push(and(...value.map((subFilter) => relationsFilterToSQL(table, subFilter, tableRelations, tablesRelations, depth))));
				continue;
			case "NOT": {
				if (value === void 0) continue;
				const built = relationsFilterToSQL(table, value, tableRelations, tablesRelations, depth);
				if (!built) continue;
				parts.push(not(built));
				continue;
			}
			default: {
				if (table[TableColumns][target]) {
					const colFilter = relationsFieldFilterToSQL(fieldSelectionToSQL(table, target), value);
					if (colFilter) parts.push(colFilter);
					continue;
				}
				const relation = tableRelations[target];
				if (!relation) throw new DrizzleError({ message: `Unknown relational filter field: "${target}"` });
				const targetTable = aliasedTable(relation.targetTable, `f${depth}`);
				const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `ft${depth}`) : void 0;
				const targetConfig = tablesRelations[relation.targetTableName];
				const { filter: relationFilter, joinCondition } = relationToSQL(relation, table, targetTable, throughTable);
				const filter = and(relationFilter, typeof value === "boolean" ? void 0 : relationsFilterToSQL(targetTable, value, targetConfig.relations, tablesRelations, depth + 1));
				const subquery = throughTable ? sql$1`(select * from ${getTableAsAliasSQL(targetTable)} inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}${sql$1` where ${filter}`.if(filter)} limit 1)` : sql$1`(select * from ${getTableAsAliasSQL(targetTable)}${sql$1` where ${filter}`.if(filter)} limit 1)`;
				if (filter) parts.push((value ? exists : notExists)(subquery));
			}
		}
	}
	return and(...parts);
}
function relationsOrderToSQL(table, orders) {
	if (typeof orders === "function") {
		const data = orders(table, orderByOperators);
		return is(data, SQL$1) ? data : Array.isArray(data) ? data.length ? sql$1.join(data.map((o) => is(o, SQL$1) ? o : asc(o)), sql$1`, `) : void 0 : is(data, Column) ? asc(data) : void 0;
	}
	const entries = Object.entries(orders).filter(([_, value]) => value);
	if (!entries.length) return void 0;
	return sql$1.join(entries.map(([target, value]) => (value === "asc" ? asc : desc)(fieldSelectionToSQL(table, target))), sql$1`, `);
}
function relationExtrasToSQL(table, extras, codecs, inJson) {
	const subqueries = [];
	const selection = [];
	for (const [key, field] of Object.entries(extras)) {
		if (!field) continue;
		const subq = (typeof field === "function" ? field(table, { sql: operators.sql }) : field).getSQL();
		const column = codecs ? getColumnFromDecoder(subq) : void 0;
		const query = column && (!inJson || !column.jsonSelectIdentifier) ? sql$1`${codecs.apply(column, inJson ? "castInJson" : "cast", sql$1`(${subq})`)} as ${sql$1.identifier(key)}` : sql$1`(${subq}) as ${sql$1.identifier(key)}`;
		query.decoder = subq.decoder;
		subqueries.push(query);
		selection.push(column && (!inJson || !column.mapFromJsonValue) ? {
			key,
			field: query,
			codec: codecs.get(column, inJson ? "normalizeInJson" : "normalize"),
			arrayDimensions: column.dimensions
		} : {
			key,
			field: query
		});
	}
	return {
		sql: subqueries.length ? sql$1.join(subqueries, sql$1`, `) : void 0,
		selection
	};
}
function relationToSQL(relation, sourceTable, targetTable, throughTable) {
	if (relation.through) {
		const outerColumnWhere = relation.sourceColumns.map((s, i) => {
			const t = relation.through.source[i];
			return eq(sql$1`${sourceTable}.${sql$1.identifier(s.name)}`, sql$1`${throughTable}.${sql$1.identifier(is(t._.column, Column) ? t._.column.name : t._.key)}`);
		});
		const innerColumnWhere = relation.targetColumns.map((s, i) => {
			const t = relation.through.target[i];
			return eq(sql$1`${throughTable}.${sql$1.identifier(is(t._.column, Column) ? t._.column.name : t._.key)}`, sql$1`${targetTable}.${sql$1.identifier(s.name)}`);
		});
		return {
			filter: and(relation.where ? relationsFilterToSQL(relation.isReversed ? sourceTable : targetTable, relation.where) : void 0, ...outerColumnWhere),
			joinCondition: and(...innerColumnWhere)
		};
	}
	return { filter: and(...relation.sourceColumns.map((s, i) => {
		const t = relation.targetColumns[i];
		return eq(sql$1`${sourceTable}.${sql$1.identifier(s.name)}`, sql$1`${targetTable}.${sql$1.identifier(t.name)}`);
	}), relation.where ? relationsFilterToSQL(relation.isReversed ? sourceTable : targetTable, relation.where) : void 0) };
}
function getTableAsAliasSQL(table) {
	return sql$1`${table[IsAlias] ? sql$1`${sql$1`${sql$1.identifier(table[TableSchema] ?? "")}.`.if(table[TableSchema])}${sql$1.identifier(table[OriginalName])} as ${table}` : table}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/migrator.utils.js
function getMigrationsToRun(params) {
	const { localMigrations, dbMigrations } = params;
	const dbNamesSet = new Set(dbMigrations.map((m) => m.name).filter((n) => n !== null));
	return localMigrations.filter((lm) => !lm.name || !dbNamesSet.has(lm.name));
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/up-migrations/utils.js
var MIGRATIONS_TABLE_VERSIONS = {
	sqlite: 1,
	pg: 1,
	effect: 1,
	mysql: 1,
	mssql: 1,
	cockroach: 1,
	singlestore: 1
};
var GET_VERSION_FOR = {
	mysql: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	pg: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	effect: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	mssql: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	cockroach: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	singlestore: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	sqlite: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/up-migrations/mysql.js
/**
* Map of upgrade functions. Each key is the version being upgraded FROM,
* and the function upgrades the table to the next version.
*/
var upgradeFunctions = { 0: async (migrationsTable, session, localMigrations) => {
	const table = sql$1`${sql$1.identifier(migrationsTable)}`;
	const dbRows = await session.objects(sql$1`SELECT id, hash, created_at FROM ${table} ORDER BY id ASC`);
	localMigrations.sort((a, b) => a.folderMillis !== b.folderMillis ? a.folderMillis - b.folderMillis : (a.name ?? "").localeCompare(b.name ?? ""));
	const byMillis = /* @__PURE__ */ new Map();
	const byHash = /* @__PURE__ */ new Map();
	for (const lm of localMigrations) {
		if (!byMillis.has(lm.folderMillis)) byMillis.set(lm.folderMillis, []);
		byMillis.get(lm.folderMillis).push(lm);
		byHash.set(lm.hash, lm);
	}
	const toApply = [];
	let unmatchedIds = [];
	for (const dbRow of dbRows) {
		const stringified = String(dbRow.created_at);
		const millis = Number(stringified.substring(0, stringified.length - 3) + "000");
		const candidates = byMillis.get(millis);
		let matched;
		if (candidates && candidates.length === 1) matched = candidates[0];
		else if (candidates && candidates.length > 1) matched = candidates.find((c) => c.hash === dbRow.hash);
		else matched = byHash.get(dbRow.hash);
		if (matched) toApply.push({
			id: dbRow.id,
			name: matched.name
		});
		else unmatchedIds.push(dbRow.id);
	}
	if (unmatchedIds.length > 0) throw Error(`While upgrading your database migrations table we found ${unmatchedIds.length} migrations (ids: ${unmatchedIds.join(", ")}) in the database that do not match any local migration. This means that some migrations were applied to the database but are missing from the local environment`);
	await session.execute(sql$1`ALTER TABLE ${table} ADD ${sql$1.identifier("name")} text`);
	await session.execute(sql$1`ALTER TABLE ${table} ADD ${sql$1.identifier("applied_at")} TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
	for (const backfillEntry of toApply) await session.execute(sql$1`UPDATE ${table} SET ${sql$1.identifier("name")} = ${backfillEntry.name}, ${sql$1.identifier("applied_at")} = NULL WHERE ${sql$1.identifier("id")} = ${backfillEntry.id}`);
} };
/**
* Detects the current version of the migrations table schema and upgrades it if needed.
*
* Version 0: Original schema (id, hash, created_at)
* Version 1: Extended schema (id, hash, created_at, name, applied_at)
*/
async function upgradeIfNeeded(migrationsTable, session, localMigrations) {
	if ((await session.objects(sql$1`SELECT 1 FROM information_schema.tables 
			WHERE table_name = ${migrationsTable}
			AND table_schema = DATABASE()`)).length === 0) return { newDb: true };
	const rows = await session.objects(sql$1`SELECT column_name as \`column_name\`
		FROM information_schema.columns
		WHERE table_name = ${migrationsTable}
		AND table_schema = DATABASE()
		ORDER BY ordinal_position`);
	const version = GET_VERSION_FOR.mysql(rows.map((r) => r.column_name));
	for (let v = version; v < MIGRATIONS_TABLE_VERSIONS.mysql; v++) {
		const upgradeFn = upgradeFunctions[v];
		if (!upgradeFn) throw new Error(`No upgrade path from migration table version ${v} to ${v + 1}`);
		await upgradeFn(migrationsTable, session, localMigrations);
	}
	return { newDb: false };
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/dialect.js
var MySqlDialect = class {
	static [entityKind] = "MySqlDialect";
	mapperGenerators;
	constructor(config) {
		if (config?.escapeParam) this.escapeParam = config.escapeParam;
		this.mapperGenerators = config?.useJitMappers ? {
			rows: makeJitQueryMapper,
			relationalRows: makeJitRqbMapper,
			$returning: make$ReturningResponseMapper
		} : {
			rows: makeDefaultQueryMapper,
			relationalRows: makeDefaultRqbMapper,
			$returning: make$ReturningResponseMapper
		};
	}
	async migrate(migrations, session, config) {
		const migrationsTable = config.migrationsTable ?? "__drizzle_migrations";
		const { newDb } = await upgradeIfNeeded(migrationsTable, session, migrations);
		if (newDb) {
			const migrationTableCreate = sql$1`
			CREATE TABLE IF NOT EXISTS ${sql$1.identifier(migrationsTable)} (
				id SERIAL PRIMARY KEY,
				hash TEXT NOT NULL,
				created_at BIGINT,
				name TEXT,
				applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`;
			await session.execute(migrationTableCreate);
		}
		const dbMigrations = await session.objects(sql$1`select id, hash, created_at, name from ${sql$1.identifier(migrationsTable)}`);
		if (typeof config === "object" && config.init) {
			if (dbMigrations.length) return { exitCode: "databaseMigrations" };
			if (migrations.length > 1) return { exitCode: "localMigrations" };
			const [migration] = migrations;
			if (!migration) return;
			await session.execute(sql$1`insert into ${sql$1.identifier(migrationsTable)} (\`hash\`, \`created_at\`, \`name\`) values(${migration.hash}, ${migration.folderMillis}, ${migration.name})`);
			return;
		}
		const migrationsToRun = getMigrationsToRun({
			localMigrations: migrations,
			dbMigrations
		});
		await session.transaction(async (tx) => {
			for (const migration of migrationsToRun) {
				for (const stmt of migration.sql) await tx.execute(sql$1.raw(stmt));
				await tx.execute(sql$1`insert into ${sql$1.identifier(migrationsTable)} (\`hash\`, \`created_at\`, \`name\`) values(${migration.hash}, ${migration.folderMillis}, ${migration.name})`);
			}
		});
	}
	escapeName(name) {
		return `\`${name.replace(/`/g, "``")}\``;
	}
	escapeParam(_num) {
		return `?`;
	}
	escapeString(str) {
		return `'${str.replace(/'/g, "''")}'`;
	}
	buildWithCTE(queries) {
		if (!queries?.length) return void 0;
		const withSqlChunks = [sql$1`with `];
		for (const [i, w] of queries.entries()) {
			withSqlChunks.push(sql$1`${sql$1.identifier(w._.alias)} as (${w._.sql})`);
			if (i < queries.length - 1) withSqlChunks.push(sql$1`, `);
		}
		withSqlChunks.push(sql$1` `);
		return sql$1.join(withSqlChunks);
	}
	buildDeleteQuery({ table, where, returning, withList, limit, orderBy, comment }) {
		const withSql = this.buildWithCTE(withList);
		const returningSql = returning ? sql$1` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
		return sql$1`${withSql}delete from ${table}${where ? sql$1` where ${where}` : void 0}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}${returningSql}${comment !== void 0 ? sql$1` ${comment}` : void 0}`;
	}
	buildUpdateSet(table, set) {
		const tableColumns = table[Table.Symbol.Columns];
		const columnNames = Object.keys(tableColumns).filter((colName) => set[colName] !== void 0 || tableColumns[colName]?.onUpdateFn !== void 0);
		const setLength = columnNames.length;
		return sql$1.join(columnNames.flatMap((colName, i) => {
			const col = tableColumns[colName];
			const onUpdateFnResult = col.onUpdateFn?.();
			const value = set[colName] ?? (is(onUpdateFnResult, SQL$1) ? onUpdateFnResult : sql$1.param(onUpdateFnResult, col));
			const res = sql$1`${sql$1.identifier(col.name)} = ${value}`;
			if (i < setLength - 1) return [res, sql$1.raw(", ")];
			return [res];
		}));
	}
	buildUpdateQuery({ table, set, where, returning, withList, limit, orderBy, comment }) {
		const withSql = this.buildWithCTE(withList);
		const setSql = this.buildUpdateSet(table, set);
		const returningSql = returning ? sql$1` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
		return sql$1`${withSql}update ${table} set ${setSql}${where ? sql$1` where ${where}` : void 0}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}${returningSql}${comment !== void 0 ? sql$1` ${comment}` : void 0}`;
	}
	/**
	* Builds selection SQL with provided fields/expressions
	*
	* Examples:
	*
	* `select <selection> from`
	*
	* `insert ... returning <selection>`
	*
	* If `isSingleTable` is true, then columns won't be prefixed with table name
	*/
	buildSelection(fields, { isSingleTable = false } = {}) {
		const columnsLen = fields.length;
		const chunks = fields.flatMap(({ field }, i) => {
			const chunk = [];
			if (is(field, SQL$1.Aliased) && field.isSelectionField) {
				if (!isSingleTable && field.origin !== void 0) chunk.push(sql$1.identifier(field.origin), sql$1.raw("."));
				chunk.push(sql$1.identifier(field.fieldAlias));
			} else if (is(field, SQL$1.Aliased) || is(field, SQL$1)) {
				const query = is(field, SQL$1.Aliased) ? field.sql : field;
				if (isSingleTable) {
					const newSql = new SQL$1(query.queryChunks.map((c) => {
						if (is(c, MySqlColumn)) return sql$1.identifier(c.name);
						return c;
					}));
					chunk.push(query.shouldInlineParams ? newSql.inlineParams() : newSql);
				} else chunk.push(query);
				if (is(field, SQL$1.Aliased)) chunk.push(sql$1` as ${sql$1.identifier(field.fieldAlias)}`);
			} else if (is(field, Column)) if (isSingleTable) chunk.push(field.isAlias ? sql$1`${sql$1.identifier(getOriginalColumnFromAlias(field).name)} as ${field}` : sql$1.identifier(field.name));
			else chunk.push(field.isAlias ? sql$1`${getOriginalColumnFromAlias(field)} as ${field}` : field);
			else if (is(field, Subquery)) {
				const entries = Object.entries(field._.selectedFields);
				if (entries.length === 1) {
					const entry = entries[0][1];
					const fieldDecoder = is(entry, SQL$1) ? entry.decoder : is(entry, Column) ? { mapFromDriverValue: (v) => entry.mapFromDriverValue(v) } : entry.sql.decoder;
					if (fieldDecoder) field._.sql.decoder = fieldDecoder;
				}
				chunk.push(field);
			}
			if (i < columnsLen - 1) chunk.push(sql$1`, `);
			return chunk;
		});
		return sql$1.join(chunks);
	}
	buildLimit(limit) {
		return typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql$1` limit ${limit}` : void 0;
	}
	buildOrderBy(orderBy) {
		return orderBy && orderBy.length > 0 ? sql$1` order by ${sql$1.join(orderBy, sql$1`, `)}` : void 0;
	}
	buildIndex({ indexes, indexFor }) {
		return indexes && indexes.length > 0 ? sql$1` ${sql$1.raw(indexFor)} INDEX ${indexes.map((it) => sql$1.identifier(it))}` : void 0;
	}
	buildSelectQuery({ withList, fields, fieldsFlat, where, having, table, joins, orderBy, groupBy, limit, offset, lockingClause, distinct, setOperators, useIndex, forceIndex, ignoreIndex, comment }) {
		const fieldsList = fieldsFlat ?? orderSelectedFields(fields);
		for (const f of fieldsList) if (is(f.field, Column) && getTableName(f.field.table) !== (is(table, Subquery) ? table._.alias : is(table, MySqlViewBase) ? table[ViewBaseConfig].name : is(table, SQL$1) ? void 0 : getTableName(table)) && !((table) => joins?.some(({ alias }) => alias === (table[Table.Symbol.IsAlias] ? getTableName(table) : table[Table.Symbol.BaseName])))(f.field.table)) {
			const tableName = getTableName(f.field.table);
			throw new Error(`Your "${f.path.join("->")}" field references a column "${tableName}"."${f.field.name}", but the table "${tableName}" is not part of the query! Did you forget to join it?`);
		}
		const isSingleTable = !joins || joins.length === 0;
		const withSql = this.buildWithCTE(withList);
		const distinctSql = distinct ? sql$1` distinct` : void 0;
		const selection = this.buildSelection(fieldsList, { isSingleTable });
		const tableSql = (() => {
			if (is(table, Table) && table[Table.Symbol.IsAlias]) return sql$1`${table[Table.Symbol.Schema] ? sql$1`${sql$1.identifier(table[Table.Symbol.Schema])}.` : void 0}${sql$1.identifier(table[Table.Symbol.OriginalName])} ${sql$1.identifier(table[Table.Symbol.Name])}`;
			if (is(table, View) && table[ViewBaseConfig].isAlias) {
				let fullName = sql$1`${sql$1.identifier(table[ViewBaseConfig].originalName)}`;
				if (table[ViewBaseConfig].schema) fullName = sql$1`${sql$1.identifier(table[ViewBaseConfig].schema)}.${fullName}`;
				return sql$1`${fullName} ${sql$1.identifier(table[ViewBaseConfig].name)}`;
			}
			return table;
		})();
		const joinsArray = [];
		if (joins) for (const [index, joinMeta] of joins.entries()) {
			if (index === 0) joinsArray.push(sql$1` `);
			const table = joinMeta.table;
			const lateralSql = joinMeta.lateral ? sql$1` lateral` : void 0;
			const onSql = joinMeta.on ? sql$1` on ${joinMeta.on}` : void 0;
			if (is(table, MySqlTable)) {
				const tableName = table[MySqlTable.Symbol.Name];
				const tableSchema = table[MySqlTable.Symbol.Schema];
				const origTableName = table[MySqlTable.Symbol.OriginalName];
				const alias = tableName === origTableName ? void 0 : joinMeta.alias;
				const useIndexSql = this.buildIndex({
					indexes: joinMeta.useIndex,
					indexFor: "USE"
				});
				const forceIndexSql = this.buildIndex({
					indexes: joinMeta.forceIndex,
					indexFor: "FORCE"
				});
				const ignoreIndexSql = this.buildIndex({
					indexes: joinMeta.ignoreIndex,
					indexFor: "IGNORE"
				});
				joinsArray.push(sql$1`${sql$1.raw(joinMeta.joinType)} join${lateralSql} ${tableSchema ? sql$1`${sql$1.identifier(tableSchema)}.` : void 0}${sql$1.identifier(origTableName)}${useIndexSql}${forceIndexSql}${ignoreIndexSql}${alias && sql$1` ${sql$1.identifier(alias)}`}${onSql}`);
			} else if (is(table, View)) {
				const viewName = table[ViewBaseConfig].name;
				const viewSchema = table[ViewBaseConfig].schema;
				const origViewName = table[ViewBaseConfig].originalName;
				const alias = viewName === origViewName ? void 0 : joinMeta.alias;
				joinsArray.push(sql$1`${sql$1.raw(joinMeta.joinType)} join${lateralSql} ${viewSchema ? sql$1`${sql$1.identifier(viewSchema)}.` : void 0}${sql$1.identifier(origViewName)}${alias && sql$1` ${sql$1.identifier(alias)}`}${onSql}`);
			} else joinsArray.push(sql$1`${sql$1.raw(joinMeta.joinType)} join${lateralSql} ${table}${onSql}`);
			if (index < joins.length - 1) joinsArray.push(sql$1` `);
		}
		const joinsSql = sql$1.join(joinsArray);
		const whereSql = where ? sql$1` where ${where}` : void 0;
		const havingSql = having ? sql$1` having ${having}` : void 0;
		const orderBySql = this.buildOrderBy(orderBy);
		const groupBySql = groupBy && groupBy.length > 0 ? sql$1` group by ${sql$1.join(groupBy, sql$1`, `)}` : void 0;
		const limitSql = this.buildLimit(limit);
		const offsetSql = offset ? sql$1` offset ${offset}` : void 0;
		const useIndexSql = this.buildIndex({
			indexes: useIndex,
			indexFor: "USE"
		});
		const forceIndexSql = this.buildIndex({
			indexes: forceIndex,
			indexFor: "FORCE"
		});
		const ignoreIndexSql = this.buildIndex({
			indexes: ignoreIndex,
			indexFor: "IGNORE"
		});
		let lockingClausesSql;
		if (lockingClause) {
			const { config, strength } = lockingClause;
			lockingClausesSql = sql$1` for ${sql$1.raw(strength)}`;
			if (config.noWait) lockingClausesSql.append(sql$1` nowait`);
			else if (config.skipLocked) lockingClausesSql.append(sql$1` skip locked`);
		}
		const finalQuery = sql$1`${withSql}select${distinctSql} ${selection} from ${tableSql}${useIndexSql}${forceIndexSql}${ignoreIndexSql}${joinsSql}${whereSql}${groupBySql}${havingSql}${orderBySql}${limitSql}${offsetSql}${lockingClausesSql}${comment !== void 0 ? sql$1` ${comment}` : void 0}`;
		if (setOperators.length > 0) return this.buildSetOperations(finalQuery, setOperators);
		return finalQuery;
	}
	buildSetOperations(leftSelect, setOperators) {
		const [setOperator, ...rest] = setOperators;
		if (!setOperator) throw new Error("Cannot pass undefined values to any set operator");
		if (rest.length === 0) return this.buildSetOperationQuery({
			leftSelect,
			setOperator
		});
		return this.buildSetOperations(this.buildSetOperationQuery({
			leftSelect,
			setOperator
		}), rest);
	}
	buildSetOperationQuery({ leftSelect, setOperator: { type, isAll, rightSelect, limit, orderBy, offset } }) {
		const leftChunk = sql$1`(${leftSelect.getSQL()}) `;
		const rightChunk = sql$1`(${rightSelect.getSQL()})`;
		let orderBySql;
		if (orderBy && orderBy.length > 0) {
			const orderByValues = [];
			for (const orderByUnit of orderBy) if (is(orderByUnit, MySqlColumn)) orderByValues.push(sql$1.identifier(orderByUnit.name));
			else if (is(orderByUnit, SQL$1)) {
				for (let i = 0; i < orderByUnit.queryChunks.length; i++) {
					const chunk = orderByUnit.queryChunks[i];
					if (is(chunk, MySqlColumn)) orderByUnit.queryChunks[i] = sql$1.identifier(chunk.name);
				}
				orderByValues.push(sql$1`${orderByUnit}`);
			} else orderByValues.push(sql$1`${orderByUnit}`);
			orderBySql = sql$1` order by ${sql$1.join(orderByValues, sql$1`, `)} `;
		}
		const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql$1` limit ${limit}` : void 0;
		const operatorChunk = sql$1.raw(`${type} ${isAll ? "all " : ""}`);
		const offsetSql = offset ? sql$1` offset ${offset}` : void 0;
		return sql$1`${leftChunk}${operatorChunk}${rightChunk}${orderBySql}${limitSql}${offsetSql}`;
	}
	buildInsertQuery({ table, values: valuesOrSelect, ignore, onConflict, select, comment }) {
		const valuesSqlList = [];
		const columns = table[Table.Symbol.Columns];
		const colEntries = Object.entries(columns).filter(([_, col]) => !col.shouldDisableInsert());
		const insertOrder = colEntries.map(([, column]) => sql$1.identifier(column.name));
		const generatedIdsResponse = [];
		if (select) {
			const select = valuesOrSelect;
			if (is(select, SQL$1)) valuesSqlList.push(select);
			else valuesSqlList.push(select.getSQL());
		} else {
			const values = valuesOrSelect;
			valuesSqlList.push(sql$1.raw("values "));
			for (const [valueIndex, value] of values.entries()) {
				const generatedIds = {};
				const valueList = [];
				for (const [fieldName, col] of colEntries) {
					const colValue = value[fieldName];
					if (colValue === void 0 || is(colValue, Param) && colValue.value === void 0) if (col.defaultFn !== void 0) {
						const defaultFnResult = col.defaultFn();
						generatedIds[fieldName] = defaultFnResult;
						const defaultValue = is(defaultFnResult, SQL$1) ? defaultFnResult : sql$1.param(defaultFnResult, col);
						valueList.push(defaultValue);
					} else if (!col.default && col.onUpdateFn !== void 0) {
						const onUpdateFnResult = col.onUpdateFn();
						const newValue = is(onUpdateFnResult, SQL$1) ? onUpdateFnResult : sql$1.param(onUpdateFnResult, col);
						valueList.push(newValue);
					} else valueList.push(sql$1`default`);
					else {
						if (col.defaultFn && is(colValue, Param)) generatedIds[fieldName] = colValue.value;
						valueList.push(colValue);
					}
				}
				generatedIdsResponse.push(generatedIds);
				valuesSqlList.push(valueList);
				if (valueIndex < values.length - 1) valuesSqlList.push(sql$1`, `);
			}
		}
		const valuesSql = sql$1.join(valuesSqlList);
		return {
			sql: sql$1`insert${ignore ? sql$1` ignore` : void 0} into ${table} ${insertOrder} ${valuesSql}${onConflict ? sql$1` on duplicate key ${onConflict}` : void 0}${comment !== void 0 ? sql$1` ${comment}` : void 0}`,
			generatedIds: generatedIdsResponse
		};
	}
	sqlToQuery(sql, invokeSource) {
		return sql.toQuery({
			escapeName: this.escapeName,
			escapeParam: this.escapeParam,
			escapeString: this.escapeString,
			invokeSource
		});
	}
	nestedSelectionerror() {
		throw new DrizzleError({ message: `Views with nested selections are not supported by the relational query builder` });
	}
	buildRqbColumn(table, column, key, inJson) {
		if (is(column, Column)) {
			const name = sql$1`${table}.${sql$1.identifier(column.name)}`;
			if (!inJson) return sql$1`${name} as ${sql$1.identifier(key)}`;
			switch (column.columnType) {
				case "MySqlBinary":
				case "MySqlVarBinary":
				case "MySqlTime":
				case "MySqlDateTimeString":
				case "MySqlTimestampString":
				case "MySqlFloat":
				case "MySqlDecimal":
				case "MySqlDecimalNumber":
				case "MySqlDecimalBigInt":
				case "MySqlBigInt64":
				case "MySqlBigIntString": return sql$1`cast(${name} as char) as ${sql$1.identifier(key)}`;
				case "MySqlBlob":
				case "MySqlBlobBuffer": return sql$1`to_base64(${name}) as ${sql$1.identifier(key)}`;
				case "MySqlCustomColumn": return sql$1`${column.jsonSelectIdentifier(name, sql$1)} as ${sql$1.identifier(key)}`;
				default: return sql$1`${name} as ${sql$1.identifier(key)}`;
			}
		}
		return sql$1`${table}.${is(column, SQL$1.Aliased) ? sql$1.identifier(column.fieldAlias) : isSQLWrapper(column) ? sql$1.identifier(key) : this.nestedSelectionerror()} as ${sql$1.identifier(key)}`;
	}
	unwrapAllColumns = (table, selection, inJson) => {
		return sql$1.join(Object.entries(table[TableColumns]).map(([k, v]) => {
			selection.push({
				key: k,
				field: v
			});
			return this.buildRqbColumn(table, v, k, inJson);
		}), sql$1`, `);
	};
	getSelectedTableColumns = (table, columns) => {
		const selectedColumns = [];
		const columnContainer = table[TableColumns];
		const entries = Object.entries(columns);
		let colSelectionMode;
		for (const [k, v] of entries) {
			if (v === void 0) continue;
			colSelectionMode = colSelectionMode || v;
			if (v) {
				const column = columnContainer[k];
				selectedColumns.push({
					column,
					tsName: k
				});
			}
		}
		if (colSelectionMode === false) for (const [k, v] of Object.entries(columnContainer)) {
			if (columns[k] === false) continue;
			selectedColumns.push({
				column: v,
				tsName: k
			});
		}
		return selectedColumns;
	};
	buildColumns = (table, selection, inJson, params) => params?.columns ? (() => {
		const columnIdentifiers = [];
		const selectedColumns = this.getSelectedTableColumns(table, params.columns);
		for (const { column, tsName } of selectedColumns) {
			columnIdentifiers.push(this.buildRqbColumn(table, column, tsName, inJson));
			selection.push({
				key: tsName,
				field: column
			});
		}
		return columnIdentifiers.length ? sql$1.join(columnIdentifiers, sql$1`, `) : void 0;
	})() : this.unwrapAllColumns(table, selection, inJson);
	buildRelationalQuery({ schema, table, tableConfig, queryConfig: config, relationWhere, mode, errorPath, depth, isNestedMany, throughJoin, nested }) {
		const selection = [];
		const isSingle = mode === "first";
		const params = config === true ? void 0 : config;
		const currentPath = errorPath ?? "";
		const currentDepth = depth ?? 0;
		if (!currentDepth) table = aliasedTable(table, `d${currentDepth}`);
		const limit = isSingle ? 1 : params?.limit;
		const offset = params?.offset;
		const columns = this.buildColumns(table, selection, !!nested, params);
		const where = params?.where && relationWhere ? and(relationsFilterToSQL(table, params.where, tableConfig.relations, schema), relationWhere) : params?.where ? relationsFilterToSQL(table, params.where, tableConfig.relations, schema) : relationWhere;
		const order = params?.orderBy ? relationsOrderToSQL(table, params.orderBy) : void 0;
		const extras = params?.extras ? relationExtrasToSQL(table, params.extras) : void 0;
		if (extras) selection.push(...extras.selection);
		const selectionArr = columns ? [columns] : [];
		if (extras?.sql) selectionArr.push(extras.sql);
		const joins = params ? (() => {
			const { with: joins } = params;
			if (!joins) return;
			const withEntries = Object.entries(joins).filter(([_, v]) => v);
			if (!withEntries.length) return;
			return sql$1.join(withEntries.map(([k, join]) => {
				selectionArr.push(sql$1`${sql$1.identifier(k)}.${sql$1.identifier("r")} as ${sql$1.identifier(k)}`);
				const relation = tableConfig.relations[k];
				const isSingle = is(relation, One$1);
				const targetTable = aliasedTable(relation.targetTable, `d${currentDepth + 1}`);
				const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `tr${currentDepth}`) : void 0;
				const { filter, joinCondition } = relationToSQL(relation, table, targetTable, throughTable);
				const throughJoin = throughTable ? sql$1` inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}` : void 0;
				const innerQuery = this.buildRelationalQuery({
					table: targetTable,
					mode: isSingle ? "first" : "many",
					schema,
					queryConfig: join,
					tableConfig: schema[relation.targetTableName],
					relationWhere: filter,
					errorPath: `${currentPath.length ? `${currentPath}.` : ""}${k}`,
					depth: currentDepth + 1,
					isNestedMany: !isSingle,
					throughJoin,
					nested: true
				});
				selection.push({
					field: targetTable,
					key: k,
					selection: innerQuery.selection,
					isArray: !isSingle,
					isOptional: (relation.optional ?? false) || join !== true && !!join.where
				});
				const jsonColumns = sql$1.join(innerQuery.selection.map((s) => sql$1`${sql$1.raw(this.escapeString(s.key))}, ${sql$1.identifier(s.key)}`), sql$1`, `);
				return sql$1` left join lateral(select ${sql$1`${isSingle ? sql$1`json_object(${jsonColumns})` : sql$1`coalesce(json_arrayagg(json_object(${jsonColumns})), json_array())`} as ${sql$1.identifier("r")}`} from (${innerQuery.sql}) as ${sql$1.identifier("t")}) as ${sql$1.identifier(k)} on true`;
			}));
		})() : void 0;
		if (!selectionArr.length) throw new DrizzleError({ message: `No fields selected for table "${tableConfig.name}"${currentPath ? ` ("${currentPath}")` : ""}` });
		if (isNestedMany && order) selectionArr.push(sql$1`row_number() over (order by ${order})`);
		const selectionSet = sql$1.join(selectionArr, sql$1`, `);
		const comment = config !== true && config?.comment ? sql$1.comment(config.comment) : void 0;
		return {
			sql: sql$1`select ${selectionSet} from ${getTableAsAliasSQL(table)}${throughJoin}${joins ? sql$1`${joins}` : void 0}${where ? sql$1` where ${where}` : void 0}${order ? sql$1` order by ${order}` : void 0}${limit !== void 0 ? sql$1` limit ${limit}` : void 0}${offset !== void 0 ? sql$1` offset ${offset}` : void 0}${comment ? sql$1` ${comment}` : void 0}`,
			selection
		};
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/query-builders/query-builder.js
var QueryBuilder$2 = class {
	static [entityKind] = "MySqlQueryBuilder";
	dialect;
	dialectConfig;
	constructor(dialect) {
		this.dialect = is(dialect, MySqlDialect) ? dialect : void 0;
		this.dialectConfig = is(dialect, MySqlDialect) ? void 0 : dialect;
	}
	$with = (alias, selection) => {
		const queryBuilder = this;
		const as = (qb) => {
			if (typeof qb === "function") qb = qb(queryBuilder);
			return new Proxy(new WithSubquery(qb.getSQL(), selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true), new SelectionProxyHandler({
				alias,
				sqlAliasedBehavior: "alias",
				sqlBehavior: "error"
			}));
		};
		return { as };
	};
	with(...queries) {
		const self = this;
		function select(fields) {
			return new MySqlSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				withList: queries
			});
		}
		function selectDistinct(fields) {
			return new MySqlSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				withList: queries,
				distinct: true
			});
		}
		return {
			select,
			selectDistinct
		};
	}
	select(fields) {
		return new MySqlSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect()
		});
	}
	selectDistinct(fields) {
		return new MySqlSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect(),
			distinct: true
		});
	}
	getDialect() {
		if (!this.dialect) this.dialect = new MySqlDialect(this.dialectConfig);
		return this.dialect;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/query-builders/count.js
var MySqlCountBuilder = class MySqlCountBuilder extends SQL$1 {
	static [entityKind] = "MySqlCountBuilder";
	dialect;
	session;
	static buildCount(source, filters, parens) {
		const query = sql$1`select count(*) from ${source}${sql$1` where ${filters}`.if(filters)}`;
		return parens ? sql$1`(${query})` : query;
	}
	constructor(countConfig) {
		super(MySqlCountBuilder.buildCount(countConfig.source, countConfig.filters, true).queryChunks);
		this.countConfig = countConfig;
		this.dialect = countConfig.dialect;
		this.session = countConfig.session;
		this.mapWith((e) => {
			if (typeof e === "number") return e;
			return Number(e ?? 0);
		});
	}
	executableSql;
	build() {
		if (!this.executableSql) {
			const { source, filters } = this.countConfig;
			this.executableSql = MySqlCountBuilder.buildCount(source, filters);
		}
		return this.dialect.sqlToQuery(this.executableSql);
	}
	execute(placeholderValues) {
		return this.session.prepareQuery(this.build(), "arrays", (rows) => {
			const v = rows[0]?.[0];
			if (typeof v === "number") return v;
			return v ? Number(v) : 0;
		}).execute(placeholderValues);
	}
};
applyMixins(MySqlCountBuilder, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/query-builders/delete.js
var MySqlDeleteBase = class extends QueryPromise {
	static [entityKind] = "MySqlDelete";
	config;
	constructor(table, session, dialect, withList) {
		super();
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.config = {
			table,
			withList
		};
	}
	/**
	* Adds a `where` clause to the query.
	*
	* Calling this method will delete only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/delete}
	*
	* @param where the `where` clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be deleted.
	*
	* ```ts
	* // Delete all cars with green color
	* db.delete(cars).where(eq(cars.color, 'green'));
	* // or
	* db.delete(cars).where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Delete all BMW cars with a green color
	* db.delete(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Delete all cars with the green or blue color
	* db.delete(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		this.config.where = where;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			this.config.orderBy = orderByArray;
		}
		return this;
	}
	limit(limit) {
		this.config.limit = limit;
		return this;
	}
	/**
	* Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
	*/
	comment(comment) {
		this.config.comment = sql$1.comment(comment);
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildDeleteQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	prepare() {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "raw", this.dialect.mapperGenerators.$returning(this.config.returning), {
			type: "delete",
			tables: extractUsedTable$2(this.config.table)
		});
	}
	execute = (placeholderValues) => {
		return this.prepare().execute(placeholderValues);
	};
	createIterator = () => {
		const self = this;
		return async function* (placeholderValues) {
			yield* self.prepare().iterator(placeholderValues);
		};
	};
	iterator = this.createIterator();
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/query-builders/insert.js
var MySqlInsertBuilder = class {
	static [entityKind] = "MySqlInsertBuilder";
	shouldIgnore = false;
	constructor(table, session, dialect) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
	}
	ignore() {
		this.shouldIgnore = true;
		return this;
	}
	values(values) {
		values = Array.isArray(values) ? values : [values];
		if (values.length === 0) throw new Error("values() must be called with at least one value");
		const mappedValues = values.map((entry) => {
			const result = {};
			const cols = this.table[Table.Symbol.Columns];
			for (const colKey of Object.keys(entry)) {
				const colValue = entry[colKey];
				result[colKey] = is(colValue, SQL$1) ? colValue : new Param(colValue, cols[colKey]);
			}
			return result;
		});
		return new MySqlInsertBase(this.table, mappedValues, this.shouldIgnore, this.session, this.dialect);
	}
	select(selectQuery) {
		const select = typeof selectQuery === "function" ? selectQuery(new QueryBuilder$2()) : selectQuery;
		if (!is(select, SQL$1) && !haveSameKeys(this.table[TableColumns], select._.selectedFields)) throw new Error("Insert select error: selected fields are not the same or are in a different order compared to the table definition");
		return new MySqlInsertBase(this.table, select, this.shouldIgnore, this.session, this.dialect, true);
	}
};
var MySqlInsertBase = class extends QueryPromise {
	static [entityKind] = "MySqlInsert";
	config;
	cacheConfig;
	constructor(table, values, ignore, session, dialect, select) {
		super();
		this.session = session;
		this.dialect = dialect;
		this.config = {
			table,
			values,
			select,
			ignore
		};
	}
	/**
	* Adds an `on duplicate key update` clause to the query.
	*
	* Calling this method will update the row if any unique index conflicts. MySQL will automatically determine the conflict target based on the primary key and unique indexes.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert#on-duplicate-key-update}
	*
	* @param config The `set` clause
	*
	* @example
	* ```ts
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW'})
	*   .onDuplicateKeyUpdate({ set: { brand: 'Porsche' }});
	* ```
	*
	* While MySQL does not directly support doing nothing on conflict, you can perform a no-op by setting any column's value to itself and achieve the same effect:
	*
	* ```ts
	* import { sql } from 'drizzle-orm';
	*
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onDuplicateKeyUpdate({ set: { id: sql`id` } });
	* ```
	*/
	onDuplicateKeyUpdate(config) {
		const setSql = this.dialect.buildUpdateSet(this.config.table, mapUpdateSet(this.config.table, config.set));
		this.config.onConflict = sql$1`update ${setSql}`;
		return this;
	}
	$returningId() {
		const returning = [];
		for (const [key, value] of Object.entries(this.config.table[Table.Symbol.Columns])) if (value.primary) returning.push({
			field: value,
			path: [key]
		});
		this.config.returning = returning;
		return this;
	}
	/**
	* Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
	*/
	comment(comment) {
		this.config.comment = sql$1.comment(comment);
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildInsertQuery(this.config).sql;
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	prepare() {
		const { sql, generatedIds } = this.dialect.buildInsertQuery(this.config);
		return this.session.prepareQuery(this.dialect.sqlToQuery(sql), "raw", this.dialect.mapperGenerators.$returning(this.config.returning, generatedIds), {
			type: "insert",
			tables: extractUsedTable$2(this.config.table)
		}, this.cacheConfig);
	}
	execute = (placeholderValues) => {
		return this.prepare().execute(placeholderValues);
	};
	createIterator = () => {
		const self = this;
		return async function* (placeholderValues) {
			yield* self.prepare().iterator(placeholderValues);
		};
	};
	iterator = this.createIterator();
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/query-builders/update.js
var MySqlUpdateBuilder = class {
	static [entityKind] = "MySqlUpdateBuilder";
	constructor(table, session, dialect, withList) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.withList = withList;
	}
	set(values) {
		return new MySqlUpdateBase(this.table, mapUpdateSet(this.table, values), this.session, this.dialect, this.withList);
	}
};
var MySqlUpdateBase = class extends QueryPromise {
	static [entityKind] = "MySqlUpdate";
	config;
	cacheConfig;
	constructor(table, set, session, dialect, withList) {
		super();
		this.session = session;
		this.dialect = dialect;
		this.config = {
			set,
			table,
			withList
		};
	}
	/**
	* Adds a 'where' clause to the query.
	*
	* Calling this method will update only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/update}
	*
	* @param where the 'where' clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be updated.
	*
	* ```ts
	* // Update all cars with green color
	* db.update(cars).set({ color: 'red' })
	*   .where(eq(cars.color, 'green'));
	* // or
	* db.update(cars).set({ color: 'red' })
	*   .where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Update all BMW cars with a green color
	* db.update(cars).set({ color: 'red' })
	*   .where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Update all cars with the green or blue color
	* db.update(cars).set({ color: 'red' })
	*   .where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		this.config.where = where;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			this.config.orderBy = orderByArray;
		}
		return this;
	}
	limit(limit) {
		this.config.limit = limit;
		return this;
	}
	/**
	* Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
	*/
	comment(comment) {
		this.config.comment = sql$1.comment(comment);
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildUpdateQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	prepare() {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "raw", this.dialect.mapperGenerators.$returning(this.config.returning, void 0), {
			type: "insert",
			tables: extractUsedTable$2(this.config.table)
		}, this.cacheConfig);
	}
	execute = (placeholderValues) => {
		return this.prepare().execute(placeholderValues);
	};
	createIterator = () => {
		const self = this;
		return async function* (placeholderValues) {
			yield* self.prepare().iterator(placeholderValues);
		};
	};
	iterator = this.createIterator();
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/query-builders/query.js
var RelationalQueryBuilder$2 = class {
	static [entityKind] = "MySqlRelationalQueryBuilderV2";
	constructor(schema, table, tableConfig, dialect, session) {
		this.schema = schema;
		this.table = table;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
	}
	findMany(config) {
		return new MySqlRelationalQuery(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "many");
	}
	findFirst(config) {
		return new MySqlRelationalQuery(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "first");
	}
};
var MySqlRelationalQuery = class extends QueryPromise {
	static [entityKind] = "MySqlRelationalQueryV2";
	constructor(schema, table, tableConfig, dialect, session, config, mode) {
		super();
		this.schema = schema;
		this.table = table;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
		this.config = config;
		this.mode = mode;
	}
	prepare() {
		const { query, builtQuery } = this._toSQL();
		const mapper = this.dialect.mapperGenerators.relationalRows({
			isFirst: this.mode === "first",
			parseJson: false,
			parseJsonIfString: false,
			rootJsonMappers: false,
			arrayModeRoot: true,
			selection: query.selection
		});
		return this.session.prepareQuery(builtQuery, "arrays", mapper);
	}
	_getQuery() {
		return this.dialect.buildRelationalQuery({
			schema: this.schema,
			table: this.table,
			tableConfig: this.tableConfig,
			queryConfig: this.config,
			mode: this.mode
		});
	}
	_toSQL() {
		const query = this._getQuery();
		return {
			builtQuery: this.dialect.sqlToQuery(query.sql),
			query
		};
	}
	/** @internal */
	getSQL() {
		return this._getQuery().sql;
	}
	toSQL() {
		return this._toSQL().builtQuery;
	}
	execute() {
		return this.prepare().execute();
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/db.js
var MySqlDatabase = class {
	static [entityKind] = "MySqlDatabase";
	query;
	constructor(dialect, session, relations) {
		this.dialect = dialect;
		this.session = session;
		this._ = {
			relations,
			session
		};
		this.query = {};
		for (const [tableName, relation] of Object.entries(relations)) this.query[tableName] = new RelationalQueryBuilder$2(relations, relations[relation.name].table, relation, dialect, session);
		this.$cache = { invalidate: async (_params) => {} };
	}
	/**
	* Creates a subquery that defines a temporary named result set as a CTE.
	*
	* It is useful for breaking down complex queries into simpler parts and for reusing the result set in subsequent parts of the query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
	*
	* @param alias The alias for the subquery.
	*
	* Failure to provide an alias will result in a DrizzleTypeError, preventing the subquery from being referenced in other queries.
	*
	* @example
	*
	* ```ts
	* // Create a subquery with alias 'sq' and use it in the select query
	* const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
	*
	* const result = await db.with(sq).select().from(sq);
	* ```
	*
	* To select arbitrary SQL values as fields in a CTE and reference them in other CTEs or in the main query, you need to add aliases to them:
	*
	* ```ts
	* // Select an arbitrary SQL value as a field in a CTE and reference it in the main query
	* const sq = db.$with('sq').as(db.select({
	*   name: sql<string>`upper(${users.name})`.as('name'),
	* })
	* .from(users));
	*
	* const result = await db.with(sq).select({ name: sq.name }).from(sq);
	* ```
	*/
	$with = (alias, selection) => {
		const self = this;
		const as = (qb) => {
			if (typeof qb === "function") qb = qb(new QueryBuilder$2(self.dialect));
			return new Proxy(new WithSubquery(qb.getSQL(), selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true), new SelectionProxyHandler({
				alias,
				sqlAliasedBehavior: "alias",
				sqlBehavior: "error"
			}));
		};
		return { as };
	};
	$count(source, filters) {
		return new MySqlCountBuilder({
			source,
			filters,
			session: this.session,
			dialect: this.dialect
		});
	}
	$cache;
	/**
	* Incorporates a previously defined CTE (using `$with`) into the main query.
	*
	* This method allows the main query to reference a temporary named result set.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
	*
	* @param queries The CTEs to incorporate into the main query.
	*
	* @example
	*
	* ```ts
	* // Define a subquery 'sq' as a CTE using $with
	* const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
	*
	* // Incorporate the CTE 'sq' into the main query and select from it
	* const result = await db.with(sq).select().from(sq);
	* ```
	*/
	with(...queries) {
		const self = this;
		function select(fields) {
			return new MySqlSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries
			});
		}
		function selectDistinct(fields) {
			return new MySqlSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries,
				distinct: true
			});
		}
		/**
		* Creates an update query.
		*
		* Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
		*
		* Use `.set()` method to specify which values to update.
		*
		* See docs: {@link https://orm.drizzle.team/docs/update}
		*
		* @param table The table to update.
		*
		* @example
		*
		* ```ts
		* // Update all rows in the 'cars' table
		* await db.update(cars).set({ color: 'red' });
		*
		* // Update rows with filters and conditions
		* await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
		* ```
		*/
		function update(table) {
			return new MySqlUpdateBuilder(table, self.session, self.dialect, queries);
		}
		/**
		* Creates a delete query.
		*
		* Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
		*
		* See docs: {@link https://orm.drizzle.team/docs/delete}
		*
		* @param table The table to delete from.
		*
		* @example
		*
		* ```ts
		* // Delete all rows in the 'cars' table
		* await db.delete(cars);
		*
		* // Delete rows with filters and conditions
		* await db.delete(cars).where(eq(cars.color, 'green'));
		* ```
		*/
		function delete_(table) {
			return new MySqlDeleteBase(table, self.session, self.dialect, queries);
		}
		return {
			select,
			selectDistinct,
			update,
			delete: delete_
		};
	}
	select(fields) {
		return new MySqlSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect
		});
	}
	selectDistinct(fields) {
		return new MySqlSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect,
			distinct: true
		});
	}
	/**
	* Creates an update query.
	*
	* Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
	*
	* Use `.set()` method to specify which values to update.
	*
	* See docs: {@link https://orm.drizzle.team/docs/update}
	*
	* @param table The table to update.
	*
	* @example
	*
	* ```ts
	* // Update all rows in the 'cars' table
	* await db.update(cars).set({ color: 'red' });
	*
	* // Update rows with filters and conditions
	* await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
	* ```
	*/
	update(table) {
		return new MySqlUpdateBuilder(table, this.session, this.dialect);
	}
	/**
	* Creates an insert query.
	*
	* Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert}
	*
	* @param table The table to insert into.
	*
	* @example
	*
	* ```ts
	* // Insert one row
	* await db.insert(cars).values({ brand: 'BMW' });
	*
	* // Insert multiple rows
	* await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
	* ```
	*/
	insert(table) {
		return new MySqlInsertBuilder(table, this.session, this.dialect);
	}
	/**
	* Creates a delete query.
	*
	* Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
	*
	* See docs: {@link https://orm.drizzle.team/docs/delete}
	*
	* @param table The table to delete from.
	*
	* @example
	*
	* ```ts
	* // Delete all rows in the 'cars' table
	* await db.delete(cars);
	*
	* // Delete rows with filters and conditions
	* await db.delete(cars).where(eq(cars.color, 'green'));
	* ```
	*/
	delete(table) {
		return new MySqlDeleteBase(table, this.session, this.dialect);
	}
	execute(query) {
		return this.session.execute(typeof query === "string" ? sql$1.raw(query) : query.getSQL());
	}
	transaction(transaction, config) {
		return this.session.transaction(transaction, config);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/mysql-core/session.js
var MySqlPreparedQuery = class {
	static [entityKind] = "MySqlPreparedQuery";
	/** @internal */
	mapper;
	fastPath;
	constructor(executor, _iterator, query, mapper, mode, logger, cache, queryMetadata, cacheConfig) {
		this.executor = executor;
		this._iterator = _iterator;
		this.query = query;
		this.mode = mode;
		this.logger = logger;
		this.cache = cache;
		this.queryMetadata = queryMetadata;
		this.cacheConfig = cacheConfig;
		this.mapper = mapper;
		if (cache && cache.strategy() === "all" && cacheConfig === void 0) this.cacheConfig = {
			enabled: true,
			autoInvalidate: true
		};
		if (!this.cacheConfig?.enabled) this.cacheConfig = void 0;
		this.fastPath = cacheConfig === void 0 && (cache === void 0 || is(cache, NoopCache));
	}
	/** @internal */
	async queryWithCache(queryString, params, query) {
		const cacheStrat = this.cache !== void 0 && !is(this.cache, NoopCache) ? await strategyFor(queryString, params, this.queryMetadata, this.cacheConfig) : { type: "skip" };
		if (cacheStrat.type === "skip") return query().catch((e) => {
			throw new DrizzleQueryError(queryString, params, e);
		});
		const cache = this.cache;
		if (cacheStrat.type === "invalidate") return Promise.all([query(), cache.onMutate({ tables: cacheStrat.tables })]).then((res) => res[0]).catch((e) => {
			throw new DrizzleQueryError(queryString, params, e);
		});
		if (cacheStrat.type === "try") {
			const { tables, key, isTag, autoInvalidate, config } = cacheStrat;
			const fromCache = await cache.get(key, tables, isTag, autoInvalidate);
			if (fromCache === void 0) {
				const result = await query().catch((e) => {
					throw new DrizzleQueryError(queryString, params, e);
				});
				await cache.put(key, result, autoInvalidate ? tables : [], isTag, config);
				return result;
			}
			return fromCache;
		}
		assertUnreachable(cacheStrat);
	}
	async execute(placeholderValues = {}) {
		const { query, logger, executor, mapper, fastPath } = this;
		const sql = query._sql ? query._sql.join(" ") : query.sql;
		const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(sql, params);
		const res = fastPath ? executor(params).catch((e) => {
			throw new DrizzleQueryError(sql, params, e);
		}) : this.queryWithCache(sql, params, () => executor(params));
		if (!mapper) return res;
		return res.then((rows) => mapper(rows));
	}
	async *iterator(placeholderValues = {}) {
		const { query, logger, executor, _iterator, mapper, fastPath } = this;
		const sql = query._sql ? query._sql.join(" ") : query.sql;
		const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(sql, params);
		if (_iterator) try {
			if (mapper) {
				for await (const row of _iterator(params)) yield mapper([row])[0];
				return;
			}
			for await (const row of _iterator(params)) yield row;
			return;
		} catch (e) {
			throw new DrizzleQueryError(sql, params, e);
		}
		const rows = await (fastPath ? executor(params).catch((e) => {
			throw new DrizzleQueryError(sql, params, e);
		}) : this.queryWithCache(sql, params, () => executor(params)));
		if (mapper) {
			for (const row of rows) yield mapper([row])[0];
			return;
		}
		for (const row of rows) yield row;
	}
};
var MySqlSession = class {
	static [entityKind] = "MySqlSession";
	constructor(dialect) {
		this.dialect = dialect;
	}
	execute(query) {
		return this.prepareQuery(this.dialect.sqlToQuery(query), "raw").execute();
	}
	arrays(query) {
		return this.prepareQuery(this.dialect.sqlToQuery(query), "arrays").execute();
	}
	objects(query) {
		return this.prepareQuery(this.dialect.sqlToQuery(query), "objects").execute();
	}
	getSetTransactionSQL(config) {
		const parts = [];
		if (config.isolationLevel) parts.push(`isolation level ${config.isolationLevel}`);
		return parts.length ? sql$1`set transaction ${sql$1.raw(parts.join(" "))}` : void 0;
	}
	getStartTransactionSQL(config) {
		const parts = [];
		if (config.withConsistentSnapshot) parts.push("with consistent snapshot");
		if (config.accessMode) parts.push(config.accessMode);
		return parts.length ? sql$1`start transaction ${sql$1.raw(parts.join(" "))}` : void 0;
	}
};
var MySqlTransaction = class extends MySqlDatabase {
	static [entityKind] = "MySqlTransaction";
	constructor(dialect, session, relations, nestedIndex) {
		super(dialect, session, relations);
		this.relations = relations;
		this.nestedIndex = nestedIndex;
	}
	rollback() {
		throw new TransactionRollbackError();
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/bun-sql/mysql/session.js
var BunMySqlSession = class BunMySqlSession extends MySqlSession {
	static [entityKind] = "BunMySqlSession";
	logger;
	cache;
	constructor(client, dialect, relations, options) {
		super(dialect);
		this.client = client;
		this.relations = relations;
		this.options = options;
		this.logger = options.logger ?? new NoopLogger();
		this.cache = options.cache ?? new NoopCache();
	}
	prepareQuery(query, mode, mapper, queryMetadata, cacheConfig) {
		const { client } = this;
		const executor = async (params = []) => {
			const raw = client.unsafe(query.sql, params);
			if (mode === "arrays") return raw.values();
			if (mode === "objects") return raw;
			if (!mapper) return raw;
			return raw.then(({ lastInsertRowid, affectedRows }) => ({
				insertId: lastInsertRowid,
				affectedRows
			}));
		};
		return new MySqlPreparedQuery(executor, void 0, query, mapper, mode, this.logger, this.cache, queryMetadata, cacheConfig);
	}
	async transaction(transaction, config) {
		const startTransactionSql = config ? this.getStartTransactionSQL(config)?.inlineParams().toQuery(this.dialect).sql.slice(18) ?? "" : "";
		if (config?.isolationLevel) throw new Error("Driver doesn't support setting isolation level on transaction");
		return this.client.begin(startTransactionSql, async (client) => {
			const session = new BunMySqlSession(client, this.dialect, this.relations, this.options);
			return transaction(new BunMySqlTransaction(this.dialect, session, this.relations, 0));
		});
	}
};
var BunMySqlTransaction = class BunMySqlTransaction extends MySqlTransaction {
	static [entityKind] = "BunMySqlTransaction";
	async transaction(transaction) {
		return this.session.client.savepoint((client) => {
			const session = new BunMySqlSession(client, this.dialect, this.relations, this.session.options);
			return transaction(new BunMySqlTransaction(this.dialect, session, this.relations, this.nestedIndex + 1));
		});
	}
};
//#endregion
//#region \0virtual:bun-shim
var SQL = class {
	constructor(urlOrConfig, config) {
		this.options = {};
	}
	prepare() {
		return this;
	}
	run() {
		return [];
	}
	all() {
		return [];
	}
	get() {
		return null;
	}
	execute() {
		return [];
	}
	values() {
		return [];
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/bun-sql/mysql/driver.js
var BunMySqlDatabase = class extends MySqlDatabase {
	static [entityKind] = "BunMySqlDatabase";
};
function construct$2(client, config = {}) {
	const dialect = new MySqlDialect({ useJitMappers: jitCompatCheck(config.jit) });
	let logger;
	if (config.logger === true) logger = new DefaultLogger();
	else if (config.logger !== false) logger = config.logger;
	const relations = config.relations ?? {};
	const db = new BunMySqlDatabase(dialect, new BunMySqlSession(client, dialect, relations, {
		logger,
		cache: config.cache
	}), relations);
	db.$client = client;
	db.$cache = config.cache;
	if (db.$cache) db.$cache["invalidate"] = config.cache?.onMutate;
	return db;
}
function drizzle$3(...params) {
	if (typeof params[0] === "string") return construct$2(new SQL(params[0]), params[1]);
	const { connection, client, ...drizzleConfig } = params[0];
	if (client) return construct$2(client, drizzleConfig);
	if (typeof connection === "object" && connection.url !== void 0) {
		const { url, ...config } = connection;
		return construct$2(new SQL({
			url,
			...config
		}), drizzleConfig);
	}
	return construct$2(new SQL(connection), drizzleConfig);
}
(function(_drizzle) {
	function mock(config) {
		return construct$2({ options: {
			parsers: {},
			serializers: {}
		} }, config);
	}
	_drizzle.mock = mock;
})(drizzle$3 || (drizzle$3 = {}));
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/array.js
function parsePgArrayValue(arrayString, startFrom, inQuotes) {
	for (let i = startFrom; i < arrayString.length; i++) {
		const char = arrayString[i];
		if (char === "\\") {
			i++;
			continue;
		}
		if (char === "\"") return [arrayString.slice(startFrom, i).replace(/\\/g, ""), i + 1];
		if (inQuotes) continue;
		if (char === "," || char === "}") return [arrayString.slice(startFrom, i).replace(/\\/g, ""), i];
	}
	return [arrayString.slice(startFrom).replace(/\\/g, ""), arrayString.length];
}
function parsePgNestedArray(arrayString, startFrom = 0) {
	const result = [];
	let i = startFrom;
	let lastCharIsComma = false;
	while (i < arrayString.length) {
		const char = arrayString[i];
		if (char === ",") {
			if (lastCharIsComma || i === startFrom) result.push("");
			lastCharIsComma = true;
			i++;
			continue;
		}
		lastCharIsComma = false;
		if (char === "\\") {
			i += 2;
			continue;
		}
		if (char === "\"") {
			const [value, startFrom] = parsePgArrayValue(arrayString, i + 1, true);
			result.push(value);
			i = startFrom;
			continue;
		}
		if (char === "}") return [result, i + 1];
		if (char === "{") {
			const [value, startFrom] = parsePgNestedArray(arrayString, i + 1);
			result.push(value);
			i = startFrom;
			continue;
		}
		const [value, newStartFrom] = parsePgArrayValue(arrayString, i, false);
		result.push(value);
		i = newStartFrom;
	}
	return [result, i];
}
function parsePgArray(arrayString) {
	const [result] = parsePgNestedArray(arrayString, 1);
	return result;
}
function makePgArray(array) {
	return `{${array.map((item) => {
		if (Array.isArray(item)) return makePgArray(item);
		if (typeof item === "string") return `"${item.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
		return `${item}`;
	}).join(",")}}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/postgis_extension/utils.js
function hexToBytes(hex) {
	const bytes = [];
	for (let c = 0; c < hex.length; c += 2) bytes.push(Number.parseInt(hex.slice(c, c + 2), 16));
	return new Uint8Array(bytes);
}
function bytesToFloat64(bytes, offset) {
	const view = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));
	for (let i = 0; i < 8; i++) view.setUint8(i, bytes[offset + i]);
	return view.getFloat64(0, true);
}
function parseEWKB(hex) {
	const bytes = hexToBytes(hex);
	let offset = 0;
	const byteOrder = bytes[offset];
	offset += 1;
	const view = new DataView(bytes.buffer);
	const geomType = view.getUint32(offset, byteOrder === 1);
	offset += 4;
	let srid;
	if (geomType & 536870912) {
		srid = view.getUint32(offset, byteOrder === 1);
		offset += 4;
	}
	if ((geomType & 65535) === 1) {
		const x = bytesToFloat64(bytes, offset);
		offset += 8;
		const y = bytesToFloat64(bytes, offset);
		offset += 8;
		return {
			srid,
			point: [x, y]
		};
	}
	throw new Error("Unsupported geometry type");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/codecs.js
var noopCodecs = {};
var arrayToItemTypeCodecNameMap = {
	cast: "cast",
	castArray: "cast",
	castInJson: "castInJson",
	castArrayInJson: "castInJson",
	castParam: "castParam",
	castArrayParam: "castParam",
	normalize: "normalize",
	normalizeArray: "normalize",
	normalizeInJson: "normalizeInJson",
	normalizeArrayInJson: "normalizeInJson",
	normalizeParam: "normalizeParam",
	normalizeParamArray: "normalizeParam"
};
var itemToArrayTypeCodecNameMap = {
	cast: "castArray",
	castArray: "castArray",
	castInJson: "castArrayInJson",
	castArrayInJson: "castArrayInJson",
	castParam: "castArrayParam",
	castArrayParam: "castArrayParam",
	normalize: "normalizeArray",
	normalizeArray: "normalizeArray",
	normalizeInJson: "normalizeArrayInJson",
	normalizeArrayInJson: "normalizeArrayInJson",
	normalizeParam: "normalizeParamArray",
	normalizeParamArray: "normalizeParamArray"
};
var CodecsCollection = class {
	static [entityKind] = "CodecsCollection";
	constructor(resolveTypes, codecs = noopCodecs) {
		this.resolveTypes = resolveTypes;
		this.codecs = codecs;
	}
	get(column, type) {
		const sqlType = column.codec;
		if (!sqlType) return void 0;
		const codecType = column.dimensions ? itemToArrayTypeCodecNameMap[type] : arrayToItemTypeCodecNameMap[type];
		return this.codecs[sqlType]?.[codecType];
	}
	apply(column, type, value) {
		const sqlType = column.codec;
		if (!sqlType) return value;
		const codecType = column.dimensions ? itemToArrayTypeCodecNameMap[type] : arrayToItemTypeCodecNameMap[type];
		const codec = this.codecs[sqlType]?.[codecType];
		if (!codec) return value;
		if (codecType === "castParam" || codecType === "castArrayParam") return codec(value, column, column.dimensions);
		return codec(value, column.dimensions);
	}
};
function refineCodecs(source, extension = {}) {
	const keys = (/* @__PURE__ */ new Set([...Object.keys(source), ...Object.keys(extension)])).values();
	const result = {};
	for (const k of keys) {
		if (!(k in extension)) {
			result[k] = source[k] ? { ...source[k] } : void 0;
			continue;
		}
		if (!(k in source) || extension[k] === void 0) {
			result[k] = extension[k] ? { ...extension[k] } : void 0;
			continue;
		}
		const innerKeys = (/* @__PURE__ */ new Set([...Object.keys(extension[k]), ...Object.keys(source[k] ?? {})])).values();
		result[k] = {};
		for (const ik of innerKeys) result[k][ik] = ik in extension[k] ? extension[k][ik] : source[k]?.[ik];
	}
	return result;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/codecs.js
var PG_ALIAS_TO_TYPE_MAP = {
	int2: "smallint",
	integer: "int",
	int4: "int",
	int8: "bigint",
	decimal: "numeric",
	real: "float4",
	double: "float8",
	"double precision": "float8",
	serial2: "smallserial",
	serial4: "serial",
	serial8: "bigserial",
	character: "char",
	"character varying": "varchar",
	"time with time zone": "timetz",
	"time without time zone": "time",
	"timestamp with time zone": "timestamptz",
	"timestamp without time zone": "timestamp",
	boolean: "bool",
	"bit varying": "varbit"
};
function resolvePgTypeAlias(type) {
	return PG_ALIAS_TO_TYPE_MAP[type] ?? type;
}
var castToText = (name) => sql$1`${name}::text`;
var castToTextArr = (name, arrayDimensions) => sql$1`${name}::text${sql$1.raw("[]".repeat(arrayDimensions))}`;
/** Used for cases when casting requires to unwrap and rebuild arrays
*
* @example
* string_mtx::text[][] // can be casted to array directly
*
* encode(bytea_mtx, 'base64')[][] // invalid syntax, cast requires unwrapping and rebuilding array
*/
var arrayCompatCast = (cast) => (name, arrayDimensions) => {
	if (!arrayDimensions) return cast(name);
	const aliases = [];
	for (let i = 0; i < arrayDimensions; i++) aliases.push(sql$1.identifier(`s${i}`));
	let indexed = name;
	for (const alias of aliases) indexed = sql$1`${indexed}[${alias}]`;
	let expression = sql$1`array(\
select ${cast(indexed)} \
from generate_subscripts(${name}, ${sql$1.raw(arrayDimensions.toString())}) ${aliases[arrayDimensions - 1]} \
order by ${aliases[arrayDimensions - 1]})`;
	for (let dim = arrayDimensions - 1; dim > 0; dim--) expression = sql$1`array(\
select ${expression} \
from generate_subscripts(${name}, ${sql$1.raw(dim.toString())}) ${aliases[dim - 1]} \
order by ${aliases[dim - 1]})`;
	return sql$1`case when ${name} is null then null else ${expression} end`;
};
/** Used to recursively apply value normalizer to array of unknown dimensions */
var arrayCompatNormalize = (normalize) => {
	const loop = (value, arrayDimensions) => {
		const innerDimensions = arrayDimensions - 1;
		if (arrayDimensions > 1) for (let i = 0; i < value.length; ++i) loop(value[i], innerDimensions);
		else for (let i = 0; i < value.length; ++i) value[i] = normalize(value[i]);
		return value;
	};
	return loop;
};
/** Doesn't mutate original data - used for insertions */
var arrayCompatNormalizeInput = (normalize, transformToPgArray = false) => {
	const loop = (value, arrayDimensions) => {
		const innerDimensions = arrayDimensions - 1;
		const out = Array.from({ length: value.length });
		if (arrayDimensions > 1) for (let i = 0; i < value.length; ++i) out[i] = loop(value[i], innerDimensions);
		else for (let i = 0; i < value.length; ++i) out[i] = normalize(value[i]);
		return out;
	};
	return transformToPgArray ? (v, d) => makePgArray(loop(v, d)) : loop;
};
/** Parses a raw PG array text representation, then applies a per-item normalizer */
var parsePgArrayAndNormalize = (normalize) => {
	const codec = arrayCompatNormalize(normalize);
	return (value, arrayDimensions) => codec(parsePgArray(value), arrayDimensions);
};
var parseLineTuple = (v) => {
	const [a, b, c] = v.slice(1, -1).split(",");
	return [
		Number.parseFloat(a),
		Number.parseFloat(b),
		Number.parseFloat(c)
	];
};
var parseLineABC = (v) => {
	const [a, b, c] = v.slice(1, -1).split(",");
	return {
		a: Number.parseFloat(a),
		b: Number.parseFloat(b),
		c: Number.parseFloat(c)
	};
};
var parsePointTuple = (v) => {
	const [x, y] = v.slice(1, -1).split(",");
	return [Number.parseFloat(x), Number.parseFloat(y)];
};
var parsePointXY = (v) => {
	const [x, y] = v.slice(1, -1).split(",");
	return {
		x: Number.parseFloat(x),
		y: Number.parseFloat(y)
	};
};
var parseGeometryTuple = (v) => parseEWKB(v).point;
var parseGeometryXY = (v) => {
	const parsed = parseEWKB(v);
	return {
		x: parsed.point[0],
		y: parsed.point[1]
	};
};
var textToDate = (v) => new Date(v);
var textToDateWithTz = (v) => /* @__PURE__ */ new Date(v + "+0000");
var parsePgVector = (v) => {
	const body = v.slice(1, -1);
	if (body.length === 0) return [];
	return body.split(",").map(Number.parseFloat);
};
var genericPgCodecs = {
	bytea: {
		castInJson: (name) => sql$1`encode(${name}, 'base64')`,
		castArrayInJson: arrayCompatCast((name) => sql$1`encode(${name}, 'base64')`),
		normalizeInJson: (v) => Buffer.from(v, "base64"),
		normalizeArrayInJson: arrayCompatNormalize((v) => Buffer.from(v, "base64"))
	},
	bigint: {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalizeInJson: BigInt,
		normalizeArrayInJson: arrayCompatNormalize(BigInt)
	},
	"bigint:number": {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalize: Number,
		normalizeArray: arrayCompatNormalize(Number),
		normalizeInJson: Number,
		normalizeArrayInJson: arrayCompatNormalize(Number)
	},
	"bigint:string": {
		castInJson: castToText,
		castArrayInJson: castToTextArr
	},
	bigserial: {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalizeInJson: BigInt,
		normalizeArrayInJson: arrayCompatNormalize(BigInt),
		normalize: BigInt,
		normalizeArray: arrayCompatNormalize(BigInt)
	},
	"bigserial:number": {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalize: Number,
		normalizeArray: arrayCompatNormalize(Number),
		normalizeInJson: Number,
		normalizeArrayInJson: arrayCompatNormalize(Number)
	},
	date: {
		normalizeInJson: textToDate,
		normalizeArrayInJson: arrayCompatNormalize(textToDate)
	},
	"date:string": {},
	enum: {
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	"geometry(point)": {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalize: parseGeometryXY,
		normalizeArray: arrayCompatNormalize(parseGeometryXY),
		normalizeInJson: parseGeometryXY,
		normalizeArrayInJson: arrayCompatNormalize(parseGeometryXY)
	},
	"geometry(point):tuple": {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalize: parseGeometryTuple,
		normalizeArray: arrayCompatNormalize(parseGeometryTuple),
		normalizeInJson: parseGeometryTuple,
		normalizeArrayInJson: arrayCompatNormalize(parseGeometryTuple)
	},
	interval: { castArrayInJson: castToTextArr },
	json: { normalizeParamArray: arrayCompatNormalizeInput((v) => JSON.stringify(v), true) },
	jsonb: { normalizeParamArray: arrayCompatNormalizeInput((v) => JSON.stringify(v), true) },
	line: {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalize: parseLineABC,
		normalizeArray: arrayCompatNormalize(parseLineABC),
		normalizeInJson: parseLineABC,
		normalizeArrayInJson: arrayCompatNormalize(parseLineABC)
	},
	"line:tuple": {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalize: parseLineTuple,
		normalizeArray: arrayCompatNormalize(parseLineTuple),
		normalizeInJson: parseLineTuple,
		normalizeArrayInJson: arrayCompatNormalize(parseLineTuple)
	},
	numeric: {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		castArray: castToTextArr
	},
	"numeric:number": {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		castArray: castToTextArr,
		normalize: Number,
		normalizeArray: arrayCompatNormalize(Number),
		normalizeInJson: Number,
		normalizeArrayInJson: arrayCompatNormalize(Number)
	},
	"numeric:bigint": {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		castArray: castToTextArr,
		normalize: BigInt,
		normalizeArray: arrayCompatNormalize(BigInt),
		normalizeInJson: BigInt,
		normalizeArrayInJson: arrayCompatNormalize(BigInt)
	},
	point: {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalize: parsePointXY,
		normalizeArray: arrayCompatNormalize(parsePointXY),
		normalizeInJson: parsePointXY,
		normalizeArrayInJson: arrayCompatNormalize(parsePointXY)
	},
	"point:tuple": {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalize: parsePointTuple,
		normalizeArray: arrayCompatNormalize(parsePointTuple),
		normalizeInJson: parsePointTuple,
		normalizeArrayInJson: arrayCompatNormalize(parsePointTuple)
	},
	timestamp: {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalizeInJson: textToDateWithTz,
		normalizeArrayInJson: arrayCompatNormalize(textToDateWithTz)
	},
	timestamptz: {
		castInJson: castToText,
		castArrayInJson: castToTextArr,
		normalizeInJson: textToDate,
		normalizeArrayInJson: arrayCompatNormalize(textToDate)
	},
	"timestamp:string": {
		castInJson: castToText,
		castArrayInJson: castToTextArr
	},
	"timestamptz:string": {
		castInJson: castToText,
		castArrayInJson: castToTextArr
	},
	halfvec: {
		normalize: parsePgVector,
		normalizeArray: parsePgArrayAndNormalize(parsePgVector),
		normalizeInJson: parsePgVector,
		normalizeArrayInJson: arrayCompatNormalize(parsePgVector)
	},
	vector: {
		normalize: parsePgVector,
		normalizeArray: parsePgArrayAndNormalize(parsePgVector),
		normalizeInJson: parsePgVector,
		normalizeArrayInJson: arrayCompatNormalize(parsePgVector)
	}
};
var refineGenericPgCodecs = (extension) => refineCodecs(genericPgCodecs, extension);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/bun-sql/postgres/codecs.js
var bunSqlPgCodecs = refineGenericPgCodecs({
	date: { normalizeParamArray: makePgArray },
	"date:string": {
		cast: castToText,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	uuid: {
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	timestamp: { normalizeParamArray: makePgArray },
	timestamptz: { normalizeParamArray: makePgArray },
	"timestamp:string": {
		cast: castToText,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	"timestamptz:string": {
		cast: castToText,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	float4: {
		cast: castToText,
		castArray: castToTextArr,
		normalize: Number,
		normalizeArray: arrayCompatNormalize(Number),
		normalizeParamArray: makePgArray
	},
	bigint: { normalizeParamArray: makePgArray },
	"bigint:number": { normalizeParamArray: makePgArray },
	"bigint:string": {
		cast: castToText,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	bigserial: { normalizeParamArray: makePgArray },
	"bigserial:number": { normalizeParamArray: makePgArray },
	int: {
		normalizeArray: (value, dimensions) => {
			if (dimensions <= 1) {
				if (value instanceof Int32Array) return Array.from(value);
				return value;
			}
			const stack = [{
				arr: value,
				depth: 1
			}];
			while (stack.length > 0) {
				const { arr, depth } = stack.pop();
				if (depth === dimensions - 1) for (let i = 0; i < arr.length; i++) {
					const leaf = arr[i];
					if (leaf instanceof Int32Array) arr[i] = Array.from(leaf);
				}
				else for (let i = 0; i < arr.length; i++) stack.push({
					arr: arr[i],
					depth: depth + 1
				});
			}
			return value;
		},
		normalizeParamArray: makePgArray
	},
	bit: { normalizeParamArray: makePgArray },
	bool: { normalizeParamArray: makePgArray },
	box: { normalizeParamArray: makePgArray },
	box2d: { normalizeParamArray: makePgArray },
	box3d: { normalizeParamArray: makePgArray },
	char: { normalizeParamArray: makePgArray },
	cidr: { normalizeParamArray: makePgArray },
	circle: { normalizeParamArray: makePgArray },
	datemultirange: { normalizeParamArray: makePgArray },
	daterange: { normalizeParamArray: makePgArray },
	float8: { normalizeParamArray: makePgArray },
	"geography(point)": { normalizeParamArray: makePgArray },
	"geography(point):tuple": { normalizeParamArray: makePgArray },
	inet: { normalizeParamArray: makePgArray },
	int4multirange: { normalizeParamArray: makePgArray },
	int4range: { normalizeParamArray: makePgArray },
	int8multirange: { normalizeParamArray: makePgArray },
	int8range: { normalizeParamArray: makePgArray },
	lseg: { normalizeParamArray: makePgArray },
	macaddr: { normalizeParamArray: makePgArray },
	money: { normalizeParamArray: makePgArray },
	nummultirange: { normalizeParamArray: makePgArray },
	numrange: { normalizeParamArray: makePgArray },
	oid: { normalizeParamArray: makePgArray },
	path: { normalizeParamArray: makePgArray },
	polygon: { normalizeParamArray: makePgArray },
	raster: { normalizeParamArray: makePgArray },
	regclass: { normalizeParamArray: makePgArray },
	regconfig: { normalizeParamArray: makePgArray },
	regdictionary: { normalizeParamArray: makePgArray },
	regnamespace: { normalizeParamArray: makePgArray },
	regoper: { normalizeParamArray: makePgArray },
	regoperator: { normalizeParamArray: makePgArray },
	regproc: { normalizeParamArray: makePgArray },
	regprocedure: { normalizeParamArray: makePgArray },
	regrole: { normalizeParamArray: makePgArray },
	regtype: { normalizeParamArray: makePgArray },
	serial: { normalizeParamArray: makePgArray },
	smallint: { normalizeParamArray: makePgArray },
	smallserial: { normalizeParamArray: makePgArray },
	text: { normalizeParamArray: makePgArray },
	time: { normalizeParamArray: makePgArray },
	timetz: { normalizeParamArray: makePgArray },
	tsmultirange: { normalizeParamArray: makePgArray },
	tsquery: { normalizeParamArray: makePgArray },
	tsrange: { normalizeParamArray: makePgArray },
	tstzmultirange: { normalizeParamArray: makePgArray },
	tstzrange: { normalizeParamArray: makePgArray },
	tsvector: { normalizeParamArray: makePgArray },
	varbit: { normalizeParamArray: makePgArray },
	varchar: { normalizeParamArray: makePgArray },
	xml: { normalizeParamArray: makePgArray },
	bytea: { normalizeParamArray: makePgArray },
	enum: { normalizeParamArray: makePgArray },
	json: { normalizeParamArray: arrayCompatNormalizeInput((v) => JSON.stringify(v), true) },
	jsonb: { normalizeParamArray: arrayCompatNormalizeInput((v) => JSON.stringify(v), true) },
	"geometry(point)": {
		normalizeArray: parsePgArrayAndNormalize(parseGeometryXY),
		normalizeParamArray: makePgArray
	},
	"geometry(point):tuple": {
		normalizeArray: parsePgArrayAndNormalize(parseGeometryTuple),
		normalizeParamArray: makePgArray
	},
	interval: {
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	line: {
		cast: castToText,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	"line:tuple": {
		cast: castToText,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	macaddr8: {
		castArrayInJson: castToTextArr,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	numeric: { normalizeParamArray: makePgArray },
	"numeric:number": { normalizeParamArray: makePgArray },
	"numeric:bigint": { normalizeParamArray: makePgArray },
	point: {
		cast: castToText,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	"point:tuple": {
		cast: castToText,
		castArray: castToTextArr,
		normalizeParamArray: makePgArray
	},
	halfvec: { normalizeParamArray: makePgArray },
	sparsevec: {
		normalizeArray: parsePgArray,
		normalizeParamArray: makePgArray
	},
	vector: { normalizeParamArray: makePgArray }
});
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/count.js
var PgCountBuilder = class PgCountBuilder extends SQL$1 {
	static [entityKind] = "PgCountBuilder";
	dialect;
	static buildCount(source, filters, parens) {
		const query = sql$1`select count(*) from ${source}${sql$1` where ${filters}`.if(filters)}`;
		return parens ? sql$1`(${query})` : query;
	}
	constructor(countConfig) {
		super(PgCountBuilder.buildCount(countConfig.source, countConfig.filters, true).queryChunks);
		this.countConfig = countConfig;
		this.dialect = countConfig.dialect;
		this.mapWith((e) => {
			if (typeof e === "number") return e;
			return Number(e ?? 0);
		});
	}
	executableSql;
	build() {
		if (!this.executableSql) {
			const { source, filters } = this.countConfig;
			this.executableSql = PgCountBuilder.buildCount(source, filters);
		}
		return this.dialect.sqlToQuery(this.executableSql);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/count.js
var PgAsyncCountBuilder = class extends PgCountBuilder {
	static [entityKind] = "PgAsyncCountBuilder";
	session;
	constructor({ source, dialect, filters, session }) {
		super({
			source,
			dialect,
			filters
		});
		this.session = session;
	}
	execute(placeholderValues) {
		return this.session.prepareQuery(this.build(), "arrays", false, (rows) => {
			const v = rows[0]?.[0];
			if (typeof v === "number") return v;
			return v ? Number(v) : 0;
		}).execute(placeholderValues);
	}
};
applyMixins(PgAsyncCountBuilder, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/query.js
var RelationalQueryBuilder$1 = class {
	static [entityKind] = "PgRelationalQueryBuilderV2";
	constructor(schema, table, tableConfig, dialect, session, parseJson, builder = PgRelationalQuery) {
		this.schema = schema;
		this.table = table;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
		this.parseJson = parseJson;
		this.builder = builder;
	}
	findMany(config) {
		return new this.builder(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "many", this.parseJson);
	}
	findFirst(config) {
		return new this.builder(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "first", this.parseJson);
	}
};
var PgRelationalQuery = class {
	static [entityKind] = "PgRelationalQueryV2";
	constructor(schema, table, tableConfig, dialect, session, config, mode, parseJson) {
		this.schema = schema;
		this.table = table;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
		this.config = config;
		this.mode = mode;
		this.parseJson = parseJson;
	}
	_getQuery() {
		return this.dialect.buildRelationalQuery({
			schema: this.schema,
			table: this.table,
			tableConfig: this.tableConfig,
			queryConfig: this.config,
			mode: this.mode
		});
	}
	getSQL() {
		return this._getQuery().sql;
	}
	_toSQL() {
		const query = this._getQuery();
		return {
			query,
			builtQuery: this.dialect.sqlToQuery(query.sql)
		};
	}
	toSQL() {
		return this._toSQL().builtQuery;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/delete.js
var PgDeleteBase = class {
	static [entityKind] = "PgDelete";
	config;
	cacheConfig;
	constructor(table, session, dialect, withList) {
		this.session = session;
		this.dialect = dialect;
		this.config = {
			table,
			withList
		};
	}
	/**
	* Adds a `where` clause to the query.
	*
	* Calling this method will delete only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/delete}
	*
	* @param where the `where` clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be deleted.
	*
	* ```ts
	* // Delete all cars with green color
	* await db.delete(cars).where(eq(cars.color, 'green'));
	* // or
	* await db.delete(cars).where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Delete all BMW cars with a green color
	* await db.delete(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Delete all cars with the green or blue color
	* await db.delete(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		this.config.where = where;
		return this;
	}
	returning(fields = this.config.table[Table.Symbol.Columns]) {
		this.config.returningFields = fields;
		this.config.returning = orderSelectedFields(fields, void 0, this.dialect.codecs);
		return this;
	}
	/**
	* Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
	*/
	comment(comment) {
		this.config.comment = sql$1.comment(comment);
		return this;
	}
	getSQL() {
		return this.dialect.buildDeleteQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	/** @internal */
	getSelectedFields() {
		return this.config.returningFields ? new Proxy(this.config.returningFields, new SelectionProxyHandler({
			alias: getTableName(this.config.table),
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		})) : void 0;
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		this.config.ignoreSelectionCastCodecs = true;
		return this;
	}
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/foreign-keys.js
var ForeignKeyBuilder$1 = class {
	static [entityKind] = "PgForeignKeyBuilder";
	/** @internal */
	reference;
	/** @internal */
	_onUpdate = "no action";
	/** @internal */
	_onDelete = "no action";
	constructor(config, actions) {
		this.reference = () => {
			const { name, columns, foreignColumns } = config();
			return {
				name,
				columns,
				foreignTable: foreignColumns[0].table,
				foreignColumns
			};
		};
		if (actions) {
			this._onUpdate = actions.onUpdate;
			this._onDelete = actions.onDelete;
		}
	}
	onUpdate(action) {
		this._onUpdate = action === void 0 ? "no action" : action;
		return this;
	}
	onDelete(action) {
		this._onDelete = action === void 0 ? "no action" : action;
		return this;
	}
	/** @internal */
	build(table) {
		return new ForeignKey$1(table, this);
	}
};
var ForeignKey$1 = class {
	static [entityKind] = "PgForeignKey";
	reference;
	onUpdate;
	onDelete;
	name;
	constructor(table, builder) {
		this.table = table;
		this.reference = builder.reference;
		this.onUpdate = builder._onUpdate;
		this.onDelete = builder._onDelete;
	}
	getName() {
		const { name, columns, foreignColumns } = this.reference();
		const columnNames = columns.map((column) => column.name);
		const foreignColumnNames = foreignColumns.map((column) => column.name);
		const chunks = [
			this.table[TableName],
			...columnNames,
			foreignColumns[0].table[TableName],
			...foreignColumnNames
		];
		return name ?? `${chunks.join("_")}_fk`;
	}
	isNameExplicit() {
		return !!this.reference().name;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/common.js
var PgColumnBuilder = class {
	static [entityKind] = "PgColumnBuilder";
	foreignKeyConfigs = [];
	config;
	constructor(name, dataType, columnType) {
		this.config = {
			name,
			keyAsName: name === "",
			notNull: false,
			default: void 0,
			hasDefault: false,
			primaryKey: false,
			isUnique: false,
			uniqueName: void 0,
			uniqueType: void 0,
			dataType,
			columnType,
			generated: void 0,
			defaultFn: void 0,
			onUpdateFn: void 0,
			generatedIdentity: void 0
		};
	}
	/**
	* Changes the data type of the column. Commonly used with `json` columns. Also, useful for branded types.
	*
	* @example
	* ```ts
	* const users = pgTable('users', {
	* 	id: integer('id').$type<UserId>().primaryKey(),
	* 	details: json('details').$type<UserDetails>().notNull(),
	* });
	* ```
	*/
	$type() {
		return this;
	}
	/**
	* Adds a `not null` clause to the column definition.
	*
	* Affects the `select` model of the table - columns *without* `not null` will be nullable on select.
	*/
	notNull() {
		this.config.notNull = true;
		return this;
	}
	/**
	* Adds a `default <value>` clause to the column definition.
	*
	* Affects the `insert` model of the table - columns *with* `default` are optional on insert.
	*
	* If you need to set a dynamic default value, use {@link $defaultFn} instead.
	*/
	default(value) {
		this.config.default = value;
		this.config.hasDefault = true;
		return this;
	}
	/**
	* Adds a dynamic default value to the column.
	* The function will be called when the row is inserted, and the returned value will be used as the column value.
	*
	* **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
	*/
	$defaultFn(fn) {
		this.config.defaultFn = fn;
		this.config.hasDefault = true;
		return this;
	}
	/**
	* Alias for {@link $defaultFn}.
	*/
	$default = this.$defaultFn;
	/**
	* Adds a dynamic update value to the column.
	* The function will be called when the row is updated, and the returned value will be used as the column value if none is provided.
	* If no `default` (or `$defaultFn`) value is provided, the function will be called when the row is inserted as well, and the returned value will be used as the column value.
	*
	* **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
	*/
	$onUpdateFn(fn) {
		this.config.onUpdateFn = fn;
		this.config.hasDefault = true;
		return this;
	}
	/**
	* Alias for {@link $onUpdateFn}.
	*/
	$onUpdate = this.$onUpdateFn;
	/**
	* Adds a `primary key` clause to the column definition. This implicitly makes the column `not null`.
	*
	* In SQLite, `integer primary key` implicitly makes the column auto-incrementing.
	*/
	primaryKey() {
		this.config.primaryKey = true;
		this.config.notNull = true;
		return this;
	}
	/** @internal Sets the name of the column to the key within the table definition if a name was not given. */
	setName(name, casingFn) {
		if (this.config.name !== "") return;
		this.config.name = casingFn(name);
	}
	array(dimensions) {
		const dim = dimensions ?? "[]";
		this.config.dimensions = dim.length / 2;
		return this;
	}
	references(ref, config = {}) {
		this.foreignKeyConfigs.push({
			ref,
			config
		});
		return this;
	}
	unique(name, config) {
		this.config.isUnique = true;
		this.config.uniqueName = name;
		this.config.uniqueType = config?.nulls;
		return this;
	}
	generatedAlwaysAs(as) {
		this.config.generated = {
			as,
			type: "always",
			mode: "stored"
		};
		return this;
	}
	/** @internal */
	buildForeignKeys(column, table) {
		return this.foreignKeyConfigs.map(({ ref, config }) => {
			return iife((ref, config) => {
				const builder = new ForeignKeyBuilder$1(() => {
					const foreignColumn = ref();
					return {
						name: config.name,
						columns: [column],
						foreignColumns: [foreignColumn]
					};
				});
				if (config.onUpdate) builder.onUpdate(config.onUpdate);
				if (config.onDelete) builder.onDelete(config.onDelete);
				return builder.build(table);
			}, ref, config);
		});
	}
	/** @internal */
	buildExtraConfigColumn(table) {
		return new ExtraConfigColumn(table, {
			...this.config,
			dimensions: this.config.dimensions ?? 0
		});
	}
};
var PgColumn = class extends Column {
	static [entityKind] = "PgColumn";
	/** @internal */
	table;
	dimensions;
	constructor(table, config) {
		super(table, config);
		this.table = table;
		this.dimensions = config.dimensions ?? 0;
	}
	/** @internal */
	postBuild() {
		if (this.dimensions) {
			const originalFromDriver = this.mapFromDriverValue.bind(this);
			const originalToDriver = this.mapToDriverValue.bind(this);
			this.mapFromDriverValue = this.mapFromDriverValue.isNoop ? this.mapFromDriverValue : (value) => {
				return this.mapArrayElements(value, originalFromDriver, this.dimensions);
			};
			this.mapToDriverValue = this.mapToDriverValue.isNoop ? this.mapToDriverValue : (value) => {
				return this.mapArrayElements(value, originalToDriver, this.dimensions);
			};
		}
		return this;
	}
	/** @internal */
	mapArrayElements(value, mapper, depth) {
		if (depth > 0 && Array.isArray(value)) return value.map((v) => v === null ? null : this.mapArrayElements(v, mapper, depth - 1));
		return mapper(value);
	}
};
var ExtraConfigColumn = class extends PgColumn {
	static [entityKind] = "ExtraConfigColumn";
	/** @itnernal */
	codec = void 0;
	getSQLType() {
		return this.getSQLType();
	}
	indexConfig = {
		order: this.config.order ?? "asc",
		nulls: this.config.nulls ?? "last",
		opClass: this.config.opClass
	};
	defaultConfig = {
		order: "asc",
		nulls: "last",
		opClass: void 0
	};
	asc() {
		this.indexConfig.order = "asc";
		return this;
	}
	desc() {
		this.indexConfig.order = "desc";
		return this;
	}
	nullsFirst() {
		this.indexConfig.nulls = "first";
		return this;
	}
	nullsLast() {
		this.indexConfig.nulls = "last";
		return this;
	}
	/**
	* ### PostgreSQL documentation quote
	*
	* > An operator class with optional parameters can be specified for each column of an index.
	* The operator class identifies the operators to be used by the index for that column.
	* For example, a B-tree index on four-byte integers would use the int4_ops class;
	* this operator class includes comparison functions for four-byte integers.
	* In practice the default operator class for the column's data type is usually sufficient.
	* The main point of having operator classes is that for some data types, there could be more than one meaningful ordering.
	* For example, we might want to sort a complex-number data type either by absolute value or by real part.
	* We could do this by defining two operator classes for the data type and then selecting the proper class when creating an index.
	* More information about operator classes check:
	*
	* ### Useful links
	* https://www.postgresql.org/docs/current/sql-createindex.html
	*
	* https://www.postgresql.org/docs/current/indexes-opclass.html
	*
	* https://www.postgresql.org/docs/current/xindex.html
	*
	* ### Additional types
	* If you have the `pg_vector` extension installed in your database, you can use the
	* `vector_l2_ops`, `vector_ip_ops`, `vector_cosine_ops`, `vector_l1_ops`, `bit_hamming_ops`, `bit_jaccard_ops`, `halfvec_l2_ops`, `sparsevec_l2_ops` options, which are predefined types.
	*
	* **You can always specify any string you want in the operator class, in case Drizzle doesn't have it natively in its types**
	*
	* @param opClass
	* @returns
	*/
	op(opClass) {
		this.indexConfig.opClass = opClass;
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/int.common.js
var PgIntColumnBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgIntColumnBaseBuilder";
	/**
	* Adds an `ALWAYS AS IDENTITY` clause to the column definition.
	* Available for integer column types.
	*/
	generatedAlwaysAsIdentity(sequence) {
		if (sequence) {
			const { name, ...options } = sequence;
			this.config.generatedIdentity = {
				type: "always",
				sequenceName: name,
				sequenceOptions: options
			};
		} else this.config.generatedIdentity = { type: "always" };
		this.config.hasDefault = true;
		this.config.notNull = true;
		return this;
	}
	/**
	* Adds a `BY DEFAULT AS IDENTITY` clause to the column definition.
	* Available for integer column types.
	*/
	generatedByDefaultAsIdentity(sequence) {
		if (sequence) {
			const { name, ...options } = sequence;
			this.config.generatedIdentity = {
				type: "byDefault",
				sequenceName: name,
				sequenceOptions: options
			};
		} else this.config.generatedIdentity = { type: "byDefault" };
		this.config.hasDefault = true;
		this.config.notNull = true;
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/bigint.js
var PgBigInt53Builder = class extends PgIntColumnBuilder {
	static [entityKind] = "PgBigInt53Builder";
	constructor(name) {
		super(name, "number int53", "PgBigInt53");
	}
	/** @internal */
	build(table) {
		return new PgBigInt53(table, this.config);
	}
};
var PgBigInt53 = class extends PgColumn {
	static [entityKind] = "PgBigInt53";
	/** @internal */
	codec = "bigint:number";
	getSQLType() {
		return "bigint";
	}
};
var PgBigInt64Builder = class extends PgIntColumnBuilder {
	static [entityKind] = "PgBigInt64Builder";
	constructor(name) {
		super(name, "bigint int64", "PgBigInt64");
	}
	/** @internal */
	build(table) {
		return new PgBigInt64(table, this.config);
	}
};
var PgBigInt64 = class extends PgColumn {
	static [entityKind] = "PgBigInt64";
	/** @internal */
	codec = "bigint";
	getSQLType() {
		return "bigint";
	}
};
var PgBigIntStringBuilder = class extends PgIntColumnBuilder {
	static [entityKind] = "PgBigIntStringBuilder";
	constructor(name) {
		super(name, "string int64", "PgBigIntString");
	}
	/** @internal */
	build(table) {
		return new PgBigIntString(table, this.config);
	}
};
var PgBigIntString = class extends PgColumn {
	static [entityKind] = "PgBigIntString";
	/** @internal */
	codec = "bigint:string";
	getSQLType() {
		return "bigint";
	}
};
function bigint(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (config.mode === "number") return new PgBigInt53Builder(name);
	if (config.mode === "string") return new PgBigIntStringBuilder(name);
	return new PgBigInt64Builder(name);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/bigserial.js
var PgBigSerial53Builder = class extends PgColumnBuilder {
	static [entityKind] = "PgBigSerial53Builder";
	constructor(name) {
		super(name, "number int53", "PgBigSerial53");
		this.config.hasDefault = true;
		this.config.notNull = true;
	}
	/** @internal */
	build(table) {
		return new PgBigSerial53(table, this.config);
	}
};
var PgBigSerial53 = class extends PgColumn {
	static [entityKind] = "PgBigSerial53";
	/** @internal */
	codec = "bigserial:number";
	getSQLType() {
		return "bigserial";
	}
};
var PgBigSerial64Builder = class extends PgColumnBuilder {
	static [entityKind] = "PgBigSerial64Builder";
	constructor(name) {
		super(name, "bigint int64", "PgBigSerial64");
		this.config.hasDefault = true;
		this.config.notNull = true;
	}
	/** @internal */
	build(table) {
		return new PgBigSerial64(table, this.config);
	}
};
var PgBigSerial64 = class extends PgColumn {
	static [entityKind] = "PgBigSerial64";
	/** @internal */
	codec = "bigserial";
	getSQLType() {
		return "bigserial";
	}
};
function bigserial(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (config.mode === "number") return new PgBigSerial53Builder(name);
	return new PgBigSerial64Builder(name);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/boolean.js
var PgBooleanBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgBooleanBuilder";
	constructor(name) {
		super(name, "boolean", "PgBoolean");
	}
	/** @internal */
	build(table) {
		return new PgBoolean(table, this.config);
	}
};
var PgBoolean = class extends PgColumn {
	static [entityKind] = "PgBoolean";
	/** @internal */
	codec = "bool";
	getSQLType() {
		return "boolean";
	}
};
function boolean(name) {
	return new PgBooleanBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/char.js
var PgCharBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgCharBuilder";
	constructor(name, config) {
		super(name, config.enum?.length ? "string enum" : "string", "PgChar");
		this.config.length = config.length ?? 1;
		this.config.setLength = config.length !== void 0;
		this.config.enumValues = config.enum;
	}
	/** @internal */
	build(table) {
		return new PgChar(table, this.config);
	}
};
var PgChar = class extends PgColumn {
	static [entityKind] = "PgChar";
	/** @internal */
	codec = "char";
	enumValues;
	setLength;
	constructor(table, config) {
		super(table, config);
		this.enumValues = config.enumValues;
		this.setLength = config.setLength;
	}
	getSQLType() {
		return this.setLength ? `char(${this.length})` : `char`;
	}
};
function char(a, b = {}) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgCharBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/cidr.js
var PgCidrBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgCidrBuilder";
	constructor(name) {
		super(name, "string cidr", "PgCidr");
	}
	/** @internal */
	build(table) {
		return new PgCidr(table, this.config);
	}
};
var PgCidr = class extends PgColumn {
	static [entityKind] = "PgCidr";
	/** @internal */
	codec = "cidr";
	getSQLType() {
		return "cidr";
	}
};
function cidr(name) {
	return new PgCidrBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/custom.js
var PgCustomColumnBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgCustomColumnBuilder";
	constructor(name, fieldConfig, customTypeParams) {
		super(name, "custom", "PgCustomColumn");
		this.config.fieldConfig = fieldConfig;
		this.config.customTypeParams = customTypeParams;
	}
	/** @internal */
	build(table) {
		return new PgCustomColumn(table, this.config);
	}
};
var PgCustomColumn = class extends PgColumn {
	static [entityKind] = "PgCustomColumn";
	/** @internal */
	codec;
	sqlName;
	mapFromJsonValue;
	jsonSelectIdentifier;
	constructor(table, config) {
		super(table, config);
		this.sqlName = config.customTypeParams.dataType(config.fieldConfig);
		this.mapToDriverValue = config.customTypeParams.toDriver ?? this.mapToDriverValue;
		this.mapFromDriverValue = config.customTypeParams.fromDriver ?? this.mapFromDriverValue;
		this.mapFromJsonValue = config.customTypeParams.fromJson;
		this.jsonSelectIdentifier = config.customTypeParams.forJsonSelect;
		const cfgCodec = typeof config.customTypeParams.codec === "string" || typeof config.customTypeParams.codec === "undefined" ? config.customTypeParams.codec : config.customTypeParams.codec(config.fieldConfig);
		this.codec = typeof cfgCodec === "string" ? resolvePgTypeAlias(cfgCodec) : void 0;
		if (this.dimensions && config.customTypeParams.fromJson) this.mapFromJsonValue = (value) => {
			if (value === null) return value;
			const arr = typeof value === "string" ? parsePgArray(value) : value;
			return this.mapJsonArrayElements(arr, config.customTypeParams.fromJson, this.dimensions);
		};
	}
	/** @internal */
	mapJsonArrayElements(value, mapper, depth) {
		if (depth > 0 && Array.isArray(value)) return value.map((v) => v === null ? null : this.mapJsonArrayElements(v, mapper, depth - 1));
		return mapper(value);
	}
	getSQLType() {
		return this.sqlName;
	}
};
/**
* Custom pg database data type generator
*/
function customType$1(customTypeParams) {
	return (a, b) => {
		const { name, config } = getColumnNameAndConfig(a, b);
		return new PgCustomColumnBuilder(name, config, customTypeParams);
	};
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/date.common.js
var PgDateColumnBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgDateColumnBaseBuilder";
	/**
	* Adds a `default now()` clause to the column definition.
	* Available for date/time column types.
	*/
	defaultNow() {
		return this.default(sql$1`now()`);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/date.js
var PgDateBuilder = class extends PgDateColumnBuilder {
	static [entityKind] = "PgDateBuilder";
	constructor(name) {
		super(name, "object date", "PgDate");
	}
	/** @internal */
	build(table) {
		return new PgDate(table, this.config);
	}
};
var PgDate = class extends PgColumn {
	static [entityKind] = "PgDate";
	/** @internal */
	codec = "date";
	getSQLType() {
		return "date";
	}
	mapToDriverValue = function(value) {
		if (typeof value === "string") return value;
		return value.toISOString();
	};
};
var PgDateStringBuilder = class extends PgDateColumnBuilder {
	static [entityKind] = "PgDateStringBuilder";
	constructor(name) {
		super(name, "string date", "PgDateString");
	}
	/** @internal */
	build(table) {
		return new PgDateString(table, this.config);
	}
};
var PgDateString = class extends PgColumn {
	static [entityKind] = "PgDateString";
	/** @internal */
	codec = "date:string";
	getSQLType() {
		return "date";
	}
	mapToDriverValue = (value) => {
		if (typeof value === "string") return value;
		return value.toISOString();
	};
};
function date(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (config?.mode === "date") return new PgDateBuilder(name);
	return new PgDateStringBuilder(name);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/double-precision.js
var PgDoublePrecisionBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgDoublePrecisionBuilder";
	constructor(name) {
		super(name, "number double", "PgDoublePrecision");
	}
	/** @internal */
	build(table) {
		return new PgDoublePrecision(table, this.config);
	}
};
var PgDoublePrecision = class extends PgColumn {
	static [entityKind] = "PgDoublePrecision";
	/** @internal */
	codec = "float8";
	getSQLType() {
		return "double precision";
	}
};
function doublePrecision(name) {
	return new PgDoublePrecisionBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/inet.js
var PgInetBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgInetBuilder";
	constructor(name) {
		super(name, "string inet", "PgInet");
	}
	/** @internal */
	build(table) {
		return new PgInet(table, this.config);
	}
};
var PgInet = class extends PgColumn {
	static [entityKind] = "PgInet";
	/** @internal */
	codec = "inet";
	getSQLType() {
		return "inet";
	}
};
function inet(name) {
	return new PgInetBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/integer.js
var PgIntegerBuilder = class extends PgIntColumnBuilder {
	static [entityKind] = "PgIntegerBuilder";
	constructor(name) {
		super(name, "number int32", "PgInteger");
	}
	/** @internal */
	build(table) {
		return new PgInteger(table, this.config);
	}
};
var PgInteger = class extends PgColumn {
	static [entityKind] = "PgInteger";
	/** @internal */
	codec = "int";
	getSQLType() {
		return "integer";
	}
};
function integer$1(name) {
	return new PgIntegerBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/interval.js
var PgIntervalBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgIntervalBuilder";
	constructor(name, intervalConfig) {
		super(name, "string interval", "PgInterval");
		this.config.intervalConfig = intervalConfig;
	}
	/** @internal */
	build(table) {
		return new PgInterval(table, this.config);
	}
};
var PgInterval = class extends PgColumn {
	static [entityKind] = "PgInterval";
	/** @internal */
	codec = "interval";
	fields;
	precision;
	constructor(table, config) {
		super(table, config);
		this.fields = config.intervalConfig.fields;
		this.precision = config.intervalConfig.precision;
	}
	getSQLType() {
		return `interval${this.fields ? ` ${this.fields}` : ""}${this.precision ? `(${this.precision})` : ""}`;
	}
};
function interval(a, b = {}) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgIntervalBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/json.js
var PgJsonBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgJsonBuilder";
	constructor(name) {
		super(name, "object json", "PgJson");
	}
	/** @internal */
	build(table) {
		return new PgJson(table, this.config);
	}
};
var PgJson = class extends PgColumn {
	static [entityKind] = "PgJson";
	/** @internal */
	codec = "json";
	constructor(table, config) {
		super(table, config);
	}
	getSQLType() {
		return "json";
	}
};
function json(name) {
	return new PgJsonBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/jsonb.js
var PgJsonbBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgJsonbBuilder";
	constructor(name) {
		super(name, "object json", "PgJsonb");
	}
	/** @internal */
	build(table) {
		return new PgJsonb(table, this.config);
	}
};
var PgJsonb = class extends PgColumn {
	static [entityKind] = "PgJsonb";
	/** @internal */
	codec = "jsonb";
	constructor(table, config) {
		super(table, config);
	}
	getSQLType() {
		return "jsonb";
	}
};
function jsonb(name) {
	return new PgJsonbBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/line.js
var PgLineBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgLineBuilder";
	constructor(name) {
		super(name, "array line", "PgLine");
	}
	/** @internal */
	build(table) {
		return new PgLineTuple(table, this.config);
	}
};
var PgLineTuple = class extends PgColumn {
	static [entityKind] = "PgLine";
	/** @internal */
	codec = "line:tuple";
	mode = "tuple";
	getSQLType() {
		return "line";
	}
	mapToDriverValue = (value) => {
		return `{${value[0]},${value[1]},${value[2]}}`;
	};
};
var PgLineABCBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgLineABCBuilder";
	constructor(name) {
		super(name, "object line", "PgLineABC");
	}
	/** @internal */
	build(table) {
		return new PgLineABC(table, this.config);
	}
};
var PgLineABC = class extends PgColumn {
	static [entityKind] = "PgLineABC";
	/** @internal */
	codec = "line";
	mode = "abc";
	getSQLType() {
		return "line";
	}
	mapToDriverValue = (value) => {
		return `{${value.a},${value.b},${value.c}}`;
	};
};
function line(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (!config?.mode || config.mode === "tuple") return new PgLineBuilder(name);
	return new PgLineABCBuilder(name);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/macaddr.js
var PgMacaddrBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgMacaddrBuilder";
	constructor(name) {
		super(name, "string macaddr", "PgMacaddr");
	}
	/** @internal */
	build(table) {
		return new PgMacaddr(table, this.config);
	}
};
var PgMacaddr = class extends PgColumn {
	static [entityKind] = "PgMacaddr";
	/** @internal */
	codec = "macaddr";
	getSQLType() {
		return "macaddr";
	}
};
function macaddr(name) {
	return new PgMacaddrBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/macaddr8.js
var PgMacaddr8Builder = class extends PgColumnBuilder {
	static [entityKind] = "PgMacaddr8Builder";
	constructor(name) {
		super(name, "string macaddr8", "PgMacaddr8");
	}
	/** @internal */
	build(table) {
		return new PgMacaddr8(table, this.config);
	}
};
var PgMacaddr8 = class extends PgColumn {
	static [entityKind] = "PgMacaddr8";
	/** @internal */
	codec = "macaddr8";
	getSQLType() {
		return "macaddr8";
	}
};
function macaddr8(name) {
	return new PgMacaddr8Builder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/numeric.js
var PgNumericBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgNumericBuilder";
	constructor(name, precision, scale) {
		super(name, "string numeric", "PgNumeric");
		this.config.precision = precision;
		this.config.scale = scale;
	}
	/** @internal */
	build(table) {
		return new PgNumeric(table, this.config);
	}
};
var PgNumeric = class extends PgColumn {
	static [entityKind] = "PgNumeric";
	/** @internal */
	codec = "numeric";
	precision;
	scale;
	constructor(table, config) {
		super(table, config);
		this.precision = config.precision;
		this.scale = config.scale;
	}
	getSQLType() {
		if (this.precision !== void 0 && this.scale !== void 0) return `numeric(${this.precision}, ${this.scale})`;
		else if (this.precision === void 0) return "numeric";
		else return `numeric(${this.precision})`;
	}
};
var PgNumericNumberBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgNumericNumberBuilder";
	constructor(name, precision, scale) {
		super(name, "number", "PgNumericNumber");
		this.config.precision = precision;
		this.config.scale = scale;
	}
	/** @internal */
	build(table) {
		return new PgNumericNumber(table, this.config);
	}
};
var PgNumericNumber = class extends PgColumn {
	static [entityKind] = "PgNumericNumber";
	/** @internal */
	codec = "numeric:number";
	precision;
	scale;
	constructor(table, config) {
		super(table, config);
		this.precision = config.precision;
		this.scale = config.scale;
	}
	mapToDriverValue = String;
	getSQLType() {
		if (this.precision !== void 0 && this.scale !== void 0) return `numeric(${this.precision}, ${this.scale})`;
		else if (this.precision === void 0) return "numeric";
		else return `numeric(${this.precision})`;
	}
};
var PgNumericBigIntBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgNumericBigIntBuilder";
	constructor(name, precision, scale) {
		super(name, "bigint int64", "PgNumericBigInt");
		this.config.precision = precision;
		this.config.scale = scale;
	}
	/** @internal */
	build(table) {
		return new PgNumericBigInt(table, this.config);
	}
};
var PgNumericBigInt = class extends PgColumn {
	static [entityKind] = "PgNumericBigInt";
	/** @internal */
	codec = "numeric:bigint";
	precision;
	scale;
	constructor(table, config) {
		super(table, config);
		this.precision = config.precision;
		this.scale = config.scale;
	}
	mapToDriverValue = String;
	getSQLType() {
		if (this.precision !== void 0 && this.scale !== void 0) return `numeric(${this.precision}, ${this.scale})`;
		else if (this.precision === void 0) return "numeric";
		else return `numeric(${this.precision})`;
	}
};
function numeric$1(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	const mode = config?.mode;
	return mode === "number" ? new PgNumericNumberBuilder(name, config?.precision, config?.scale) : mode === "bigint" ? new PgNumericBigIntBuilder(name, config?.precision, config?.scale) : new PgNumericBuilder(name, config?.precision, config?.scale);
}
var decimal = numeric$1;
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/point.js
var PgPointTupleBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgPointTupleBuilder";
	constructor(name) {
		super(name, "array point", "PgPointTuple");
	}
	/** @internal */
	build(table) {
		return new PgPointTuple(table, this.config);
	}
};
var PgPointTuple = class extends PgColumn {
	static [entityKind] = "PgPointTuple";
	/** @internal */
	codec = "point:tuple";
	mode = "tuple";
	getSQLType() {
		return "point";
	}
	mapToDriverValue = (value) => {
		return `(${value[0]},${value[1]})`;
	};
};
var PgPointObjectBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgPointObjectBuilder";
	constructor(name) {
		super(name, "object point", "PgPointObject");
	}
	/** @internal */
	build(table) {
		return new PgPointObject(table, this.config);
	}
};
var PgPointObject = class extends PgColumn {
	static [entityKind] = "PgPointObject";
	/** @internal */
	codec = "point";
	mode = "xy";
	getSQLType() {
		return "point";
	}
	mapToDriverValue = (value) => {
		return `(${value.x},${value.y})`;
	};
};
function point(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (!config?.mode || config.mode === "tuple") return new PgPointTupleBuilder(name);
	return new PgPointObjectBuilder(name);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/postgis_extension/geometry.js
var PgGeometryBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgGeometryBuilder";
	constructor(name, srid) {
		super(name, "array geometry", "PgGeometry");
		this.config.srid = srid;
	}
	/** @internal */
	build(table) {
		return new PgGeometry(table, this.config);
	}
};
var PgGeometry = class extends PgColumn {
	static [entityKind] = "PgGeometry";
	/** @internal */
	codec = "geometry(point):tuple";
	srid = this.config.srid;
	mode = "tuple";
	getSQLType() {
		return `geometry(point${this.srid === void 0 ? "" : `,${this.srid}`})`;
	}
	mapToDriverValue = (value) => {
		return `point(${value[0]} ${value[1]})`;
	};
};
var PgGeometryObjectBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgGeometryObjectBuilder";
	constructor(name, srid) {
		super(name, "object geometry", "PgGeometryObject");
		this.config.srid = srid;
	}
	/** @internal */
	build(table) {
		return new PgGeometryObject(table, this.config);
	}
};
var PgGeometryObject = class extends PgColumn {
	static [entityKind] = "PgGeometryObject";
	/** @internal */
	codec = "geometry(point)";
	srid = this.config.srid;
	mode = "object";
	getSQLType() {
		return `geometry(point${this.srid === void 0 ? "" : `,${this.srid}`})`;
	}
	mapToDriverValue = (value) => {
		return `point(${value.x} ${value.y})`;
	};
};
function geometry(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (!config?.mode || config.mode === "tuple") return new PgGeometryBuilder(name, config?.srid);
	return new PgGeometryObjectBuilder(name, config?.srid);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/real.js
var PgRealBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgRealBuilder";
	constructor(name, length) {
		super(name, "number float", "PgReal");
		this.config.length = length;
	}
	/** @internal */
	build(table) {
		return new PgReal(table, this.config);
	}
};
var PgReal = class extends PgColumn {
	static [entityKind] = "PgReal";
	/** @internal */
	codec = "float4";
	constructor(table, config) {
		super(table, config);
	}
	getSQLType() {
		return "real";
	}
};
function real$1(name) {
	return new PgRealBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/serial.js
var PgSerialBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgSerialBuilder";
	constructor(name) {
		super(name, "number int32", "PgSerial");
		this.config.hasDefault = true;
		this.config.notNull = true;
	}
	/** @internal */
	build(table) {
		return new PgSerial(table, this.config);
	}
};
var PgSerial = class extends PgColumn {
	static [entityKind] = "PgSerial";
	/** @internal */
	codec = "serial";
	getSQLType() {
		return "serial";
	}
};
function serial(name) {
	return new PgSerialBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/smallint.js
var PgSmallIntBuilder = class extends PgIntColumnBuilder {
	static [entityKind] = "PgSmallIntBuilder";
	constructor(name) {
		super(name, "number int16", "PgSmallInt");
	}
	/** @internal */
	build(table) {
		return new PgSmallInt(table, this.config);
	}
};
var PgSmallInt = class extends PgColumn {
	static [entityKind] = "PgSmallInt";
	/** @internal */
	codec = "smallint";
	getSQLType() {
		return "smallint";
	}
};
function smallint(name) {
	return new PgSmallIntBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/smallserial.js
var PgSmallSerialBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgSmallSerialBuilder";
	constructor(name) {
		super(name, "number int16", "PgSmallSerial");
		this.config.hasDefault = true;
		this.config.notNull = true;
	}
	/** @internal */
	build(table) {
		return new PgSmallSerial(table, this.config);
	}
};
var PgSmallSerial = class extends PgColumn {
	static [entityKind] = "PgSmallSerial";
	/** @internal */
	codec = "smallserial";
	getSQLType() {
		return "smallserial";
	}
};
function smallserial(name) {
	return new PgSmallSerialBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/text.js
var PgTextBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgTextBuilder";
	constructor(name, config) {
		super(name, config.enum?.length ? "string enum" : "string", "PgText");
		this.config.enumValues = config.enum;
	}
	/** @internal */
	build(table) {
		return new PgText(table, this.config, this.config.enumValues);
	}
};
var PgText = class extends PgColumn {
	static [entityKind] = "PgText";
	enumValues;
	/** @internal */
	codec = "text";
	constructor(table, config, enumValues) {
		super(table, config);
		this.enumValues = enumValues;
	}
	getSQLType() {
		return "text";
	}
};
function text$1(a, b = {}) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgTextBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/time.js
var PgTimeBuilder = class extends PgDateColumnBuilder {
	static [entityKind] = "PgTimeBuilder";
	constructor(name, withTimezone, precision) {
		super(name, "string time", "PgTime");
		this.withTimezone = withTimezone;
		this.precision = precision;
		this.config.withTimezone = withTimezone;
		this.config.precision = precision;
	}
	/** @internal */
	build(table) {
		return new PgTime(table, this.config);
	}
};
var PgTime = class extends PgColumn {
	static [entityKind] = "PgTime";
	/** @internal */
	codec = "time";
	withTimezone;
	precision;
	constructor(table, config) {
		super(table, config);
		this.withTimezone = config.withTimezone;
		this.precision = config.precision;
	}
	getSQLType() {
		return `time${this.precision === void 0 ? "" : `(${this.precision})`}${this.withTimezone ? " with time zone" : ""}`;
	}
};
function time(a, b = {}) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgTimeBuilder(name, config.withTimezone ?? false, config.precision);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/timestamp.js
var PgTimestampBuilder = class extends PgDateColumnBuilder {
	static [entityKind] = "PgTimestampBuilder";
	constructor(name, withTimezone, precision) {
		super(name, "object date", "PgTimestamp");
		this.config.withTimezone = withTimezone;
		this.config.precision = precision;
	}
	/** @internal */
	build(table) {
		return new PgTimestamp(table, this.config);
	}
};
var PgTimestamp = class extends PgColumn {
	static [entityKind] = "PgTimestamp";
	/** @internal */
	codec;
	withTimezone;
	precision;
	constructor(table, config) {
		super(table, config);
		this.withTimezone = config.withTimezone;
		this.precision = config.precision;
		this.codec = this.withTimezone ? "timestamptz" : "timestamp";
	}
	getSQLType() {
		return `timestamp${this.precision === void 0 ? "" : ` (${this.precision})`}${this.withTimezone ? " with time zone" : ""}`;
	}
	mapToDriverValue = (value) => {
		if (typeof value === "string") return value;
		return value.toISOString();
	};
};
var PgTimestampStringBuilder = class extends PgDateColumnBuilder {
	static [entityKind] = "PgTimestampStringBuilder";
	constructor(name, withTimezone, precision) {
		super(name, "string timestamp", "PgTimestampString");
		this.config.withTimezone = withTimezone;
		this.config.precision = precision;
	}
	/** @internal */
	build(table) {
		return new PgTimestampString(table, this.config);
	}
};
var PgTimestampString = class extends PgColumn {
	static [entityKind] = "PgTimestampString";
	/** @internal */
	codec;
	withTimezone;
	precision;
	constructor(table, config) {
		super(table, config);
		this.withTimezone = config.withTimezone;
		this.precision = config.precision;
		this.codec = this.withTimezone ? "timestamptz:string" : "timestamp:string";
	}
	getSQLType() {
		return `timestamp${this.precision === void 0 ? "" : `(${this.precision})`}${this.withTimezone ? " with time zone" : ""}`;
	}
	mapToDriverValue = (value) => {
		if (typeof value === "string") return value;
		return value.toISOString();
	};
};
function timestamp(a, b = {}) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (config?.mode === "string") return new PgTimestampStringBuilder(name, config.withTimezone ?? false, config.precision);
	return new PgTimestampBuilder(name, config?.withTimezone ?? false, config?.precision);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/uuid.js
var PgUUIDBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgUUIDBuilder";
	constructor(name) {
		super(name, "string uuid", "PgUUID");
	}
	/**
	* Adds `default gen_random_uuid()` to the column definition.
	*/
	defaultRandom() {
		return this.default(sql$1`gen_random_uuid()`);
	}
	/** @internal */
	build(table) {
		return new PgUUID(table, this.config);
	}
};
var PgUUID = class extends PgColumn {
	static [entityKind] = "PgUUID";
	/** @internal */
	codec = "uuid";
	getSQLType() {
		return "uuid";
	}
};
function uuid(name) {
	return new PgUUIDBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/varchar.js
var PgVarcharBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgVarcharBuilder";
	constructor(name, config) {
		super(name, config.enum?.length ? "string enum" : "string", "PgVarchar");
		this.config.length = config.length;
		this.config.enumValues = config.enum;
	}
	/** @internal */
	build(table) {
		return new PgVarchar(table, this.config);
	}
};
var PgVarchar = class extends PgColumn {
	static [entityKind] = "PgVarchar";
	/** @internal */
	codec = "varchar";
	enumValues;
	constructor(table, config) {
		super(table, config);
		this.enumValues = config.enumValues;
	}
	getSQLType() {
		return this.length === void 0 ? `varchar` : `varchar(${this.length})`;
	}
};
function varchar(a, b = {}) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgVarcharBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/vector_extension/bit.js
var PgBinaryVectorBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgBinaryVectorBuilder";
	constructor(name, config) {
		super(name, "string binary", "PgBinaryVector");
		this.config.length = config.dimensions;
		this.config.isLengthExact = true;
	}
	/** @internal */
	build(table) {
		return new PgBinaryVector(table, this.config);
	}
};
var PgBinaryVector = class extends PgColumn {
	static [entityKind] = "PgBinaryVector";
	/** @internal */
	codec = "bit";
	getSQLType() {
		return `bit(${this.length})`;
	}
};
function bit(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgBinaryVectorBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/vector_extension/halfvec.js
var PgHalfVectorBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgHalfVectorBuilder";
	constructor(name, config) {
		super(name, "array halfvector", "PgHalfVector");
		this.config.length = config.dimensions;
		this.config.isLengthExact = true;
	}
	/** @internal */
	build(table) {
		return new PgHalfVector(table, this.config);
	}
};
var PgHalfVector = class extends PgColumn {
	static [entityKind] = "PgHalfVector";
	/** @internal */
	codec = "halfvec";
	getSQLType() {
		return `halfvec(${this.length})`;
	}
	mapToDriverValue = (value) => {
		return JSON.stringify(value);
	};
};
function halfvec(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgHalfVectorBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/vector_extension/sparsevec.js
var PgSparseVectorBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgSparseVectorBuilder";
	constructor(name, config) {
		super(name, "string sparsevec", "PgSparseVector");
		this.config.vectorDimensions = config.dimensions;
	}
	/** @internal */
	build(table) {
		return new PgSparseVector(table, this.config);
	}
};
var PgSparseVector = class extends PgColumn {
	static [entityKind] = "PgSparseVector";
	/** @internal */
	codec = "sparsevec";
	vectorDimensions = this.config.vectorDimensions;
	getSQLType() {
		return `sparsevec(${this.vectorDimensions})`;
	}
};
function sparsevec(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgSparseVectorBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/vector_extension/vector.js
var PgVectorBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgVectorBuilder";
	constructor(name, config) {
		super(name, "array vector", "PgVector");
		this.config.length = config.dimensions;
		this.config.isLengthExact = true;
	}
	/** @internal */
	build(table) {
		return new PgVector(table, this.config);
	}
};
var PgVector = class extends PgColumn {
	static [entityKind] = "PgVector";
	/** @internal */
	codec = "vector";
	getSQLType() {
		return `vector(${this.length})`;
	}
	mapToDriverValue = (value) => {
		return JSON.stringify(value);
	};
};
function vector(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	return new PgVectorBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/all.js
function getPgColumnBuilders() {
	return {
		bigint,
		bigserial,
		boolean,
		char,
		cidr,
		customType: customType$1,
		date,
		doublePrecision,
		inet,
		integer: integer$1,
		interval,
		json,
		jsonb,
		line,
		macaddr,
		macaddr8,
		numeric: numeric$1,
		point,
		geometry,
		real: real$1,
		serial,
		smallint,
		smallserial,
		text: text$1,
		time,
		timestamp,
		uuid,
		varchar,
		bit,
		halfvec,
		sparsevec,
		vector
	};
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/table.js
/** @internal */
var InlineForeignKeys$1 = Symbol.for("drizzle:PgInlineForeignKeys");
/** @internal */
var EnableRLS = Symbol.for("drizzle:EnableRLS");
var PgTable = class extends Table {
	static [entityKind] = "PgTable";
	/** @internal */
	static Symbol = Object.assign({}, Table.Symbol, {
		InlineForeignKeys: InlineForeignKeys$1,
		EnableRLS
	});
	/**@internal */
	[InlineForeignKeys$1] = [];
	/** @internal */
	[EnableRLS] = false;
	/** @internal */
	[Table.Symbol.ExtraConfigBuilder] = void 0;
	/** @internal */
	[Table.Symbol.ExtraConfigColumns] = {};
};
/** @internal */
function pgTableWithSchema(name, columns, extraConfig, schema, casing, baseName = name) {
	const casingFn = getCasingFn(casing);
	const rawTable = new PgTable(name, schema, baseName);
	const parsedColumns = typeof columns === "function" ? columns(getPgColumnBuilders()) : columns;
	const builtColumns = Object.fromEntries(Object.entries(parsedColumns).map(([name, colBuilderBase]) => {
		const colBuilder = colBuilderBase;
		colBuilder.setName(name, casingFn);
		const column = colBuilder.build(rawTable).postBuild();
		rawTable[InlineForeignKeys$1].push(...colBuilder.buildForeignKeys(column, rawTable));
		return [name, column];
	}));
	const builtColumnsForExtraConfig = Object.fromEntries(Object.entries(parsedColumns).map(([name, colBuilderBase]) => {
		const colBuilder = colBuilderBase;
		colBuilder.setName(name, casingFn);
		return [name, colBuilder.buildExtraConfigColumn(rawTable)];
	}));
	const table = Object.assign(rawTable, builtColumns);
	table[Table.Symbol.Columns] = builtColumns;
	table[Table.Symbol.ExtraConfigColumns] = builtColumnsForExtraConfig;
	if (extraConfig) table[PgTable.Symbol.ExtraConfigBuilder] = extraConfig;
	return Object.assign(table, { enableRLS: () => {
		table[PgTable.Symbol.EnableRLS] = true;
		return table;
	} });
}
/** @internal */
function pgTableWithCasing(casing) {
	const pgTableInternal = (name, columns, extraConfig) => {
		return pgTableWithSchema(name, columns, extraConfig, void 0, casing);
	};
	const pgTableWithRLS = (name, columns, extraConfig) => {
		const table = pgTableWithSchema(name, columns, extraConfig, void 0, casing);
		table[EnableRLS] = true;
		return table;
	};
	return Object.assign(pgTableInternal, { withRLS: pgTableWithRLS });
}
var pgTable = pgTableWithCasing(void 0);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/primary-keys.js
var PrimaryKeyBuilder = class {
	static [entityKind] = "PgPrimaryKeyBuilder";
	/** @internal */
	columns;
	/** @internal */
	name;
	constructor(columns, name) {
		this.columns = columns;
		this.name = name;
	}
	/** @internal */
	build(table) {
		return new PrimaryKey(table, this.columns, this.name);
	}
};
var PrimaryKey = class {
	static [entityKind] = "PgPrimaryKey";
	columns;
	name;
	isNameExplicit;
	constructor(table, columns, name) {
		this.table = table;
		this.columns = columns;
		this.name = name;
		this.isNameExplicit = !!name;
	}
	getName() {
		return this.name ?? `${this.table[PgTable.Symbol.Name]}_${this.columns.map((column) => column.name).join("_")}_pk`;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/utils.js
function extractUsedTable$1(table) {
	if (is(table, PgTable)) return [table[TableSchema] ? `${table[TableSchema]}.${table[Table.Symbol.BaseName]}` : table[Table.Symbol.BaseName]];
	if (is(table, Subquery)) return table._.usedTables ?? [];
	if (is(table, SQL$1)) return table.usedTables ?? [];
	return [];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/delete.js
var PgAsyncDeleteBase = class extends PgDeleteBase {
	static [entityKind] = "PgAsyncDelete";
	/** @internal */
	_prepare(name, generateName = false) {
		const { session, config, dialect, cacheConfig } = this;
		const { returning: fields } = config;
		return tracer.startActiveSpan("drizzle.prepareQuery", () => {
			const query = dialect.sqlToQuery(this.getSQL());
			const mapper = fields ? this.dialect.mapperGenerators.rows(fields, void 0) : void 0;
			return session.prepareQuery(query, fields ? "arrays" : "raw", name ?? generateName, mapper, {
				type: "delete",
				tables: [...extractUsedTable$1(this.config.table)]
			}, cacheConfig);
		});
	}
	prepare(name) {
		return this._prepare(name, true);
	}
	execute = (placeholderValues) => {
		return tracer.startActiveSpan("drizzle.operation", () => {
			return this._prepare().execute(placeholderValues);
		});
	};
};
applyMixins(PgAsyncDeleteBase, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/view-base.js
var PgViewBase = class extends View {
	static [entityKind] = "PgViewBase";
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/select.js
var PgSelectBuilder = class {
	static [entityKind] = "PgSelectBuilder";
	fields;
	session;
	dialect;
	withList = [];
	distinct;
	tagged;
	constructor(config, builder = PgSelectBase) {
		this.builder = builder;
		this.fields = config.fields;
		this.session = config.session;
		this.dialect = config.dialect;
		if (config.withList) this.withList = config.withList;
		this.distinct = config.distinct;
	}
	/**
	* Specify the table, subquery, or other target that you're
	* building a select query against.
	*
	* {@link https://www.postgresql.org/docs/current/sql-select.html#SQL-FROM | Postgres from documentation}
	*/
	from(source) {
		const isPartialSelect = !!this.fields;
		const src = source;
		let fields;
		if (this.fields) fields = this.fields;
		else if (is(src, Subquery)) fields = Object.fromEntries(Object.keys(src._.selectedFields).map((key) => [key, src[key]]));
		else if (is(src, PgViewBase)) fields = src[ViewBaseConfig].selectedFields;
		else if (is(src, SQL$1)) fields = {};
		else fields = getTableColumns(src);
		return new this.builder({
			table: src,
			fields,
			isPartialSelect,
			session: this.session,
			dialect: this.dialect,
			withList: this.withList,
			distinct: this.distinct
		});
	}
};
var PgSelectBase = class extends TypedQueryBuilder {
	static [entityKind] = "PgSelectQueryBuilder";
	_;
	config;
	joinsNotNullableMap;
	tableName;
	isPartialSelect;
	session;
	dialect;
	cacheConfig;
	usedTables = /* @__PURE__ */ new Set();
	constructor(config) {
		super();
		this.session = config.session;
		this.dialect = config.dialect;
		this.config = {
			withList: config.withList,
			table: config.table,
			fields: { ...config.fields },
			distinct: config.distinct,
			setOperators: []
		};
		this.isPartialSelect = config.isPartialSelect;
		this._ = {
			selectedFields: this.config.fields,
			config: this.config
		};
		this.tableName = getTableLikeName(config.table);
		this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
		for (const item of extractUsedTable$1(config.table)) this.usedTables.add(item);
		this.config.withList?.forEach((it) => {
			const extracted = extractUsedTable$1(it);
			for (const el of extracted) this.usedTables.add(el);
		});
	}
	/** @internal */
	getUsedTables() {
		return [...this.usedTables];
	}
	createJoin(joinType, lateral) {
		return ((table, on) => {
			const baseTableName = this.tableName;
			const tableName = getTableLikeName(table);
			for (const item of extractUsedTable$1(table)) this.usedTables.add(item);
			if (typeof tableName === "string" && this.config.joins?.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
			if (!this.isPartialSelect) {
				if (Object.keys(this.joinsNotNullableMap).length === 1 && typeof baseTableName === "string") this.config.fields = { [baseTableName]: this.config.fields };
				if (typeof tableName === "string" && !is(table, SQL$1)) {
					const selection = is(table, Subquery) ? table._.selectedFields : is(table, View) ? table[ViewBaseConfig].selectedFields : table[Table.Symbol.Columns];
					this.config.fields[tableName] = selection;
				}
			}
			if (typeof on === "function") on = on(new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "sql",
				sqlBehavior: "sql"
			})));
			if (!this.config.joins) this.config.joins = [];
			this.config.joins.push({
				on,
				table,
				joinType,
				alias: tableName,
				lateral
			});
			if (typeof tableName === "string") switch (joinType) {
				case "left":
					this.joinsNotNullableMap[tableName] = false;
					break;
				case "right":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "cross":
				case "inner":
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "full":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = false;
					break;
			}
			return this;
		});
	}
	/**
	* Executes a `left join` operation by adding another table to the current query.
	*
	* Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#left-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User; pets: Pet | null; }[] = await db.select()
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	leftJoin = this.createJoin("left", false);
	/**
	* Executes a `left join lateral` operation by adding subquery to the current query.
	*
	* A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
	*
	* Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#left-join-lateral}
	*
	* @param table the subquery to join.
	* @param on the `on` clause.
	*/
	leftJoinLateral = this.createJoin("left", true);
	/**
	* Executes a `right join` operation by adding another table to the current query.
	*
	* Calling this method associates each row of the joined table with the corresponding row from the main table, if a match is found. If no matching row exists, it sets all columns of the main table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#right-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User | null; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .rightJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number | null; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .rightJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	rightJoin = this.createJoin("right", false);
	/**
	* Executes an `inner join` operation, creating a new table by combining rows from two tables that have matching values.
	*
	* Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#inner-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .innerJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .innerJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	innerJoin = this.createJoin("inner", false);
	/**
	* Executes an `inner join lateral` operation, creating a new table by combining rows from two queries that have matching values.
	*
	* A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
	*
	* Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#inner-join-lateral}
	*
	* @param table the subquery to join.
	* @param on the `on` clause.
	*/
	innerJoinLateral = this.createJoin("inner", true);
	/**
	* Executes a `full join` operation by combining rows from two tables into a new table.
	*
	* Calling this method retrieves all rows from both main and joined tables, merging rows with matching values and filling in `null` for non-matching columns.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#full-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User | null; pets: Pet | null; }[] = await db.select()
	*   .from(users)
	*   .fullJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number | null; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .fullJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	fullJoin = this.createJoin("full", false);
	/**
	* Executes a `cross join` operation by combining rows from two tables into a new table.
	*
	* Calling this method retrieves all rows from both main and joined tables, merging all rows from each table.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#cross-join}
	*
	* @param table the table to join.
	*
	* @example
	*
	* ```ts
	* // Select all users, each user with every pet
	* const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .crossJoin(pets)
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .crossJoin(pets)
	* ```
	*/
	crossJoin = this.createJoin("cross", false);
	/**
	* Executes a `cross join lateral` operation by combining rows from two queries into a new table.
	*
	* A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
	*
	* Calling this method retrieves all rows from both main and joined queries, merging all rows from each query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#cross-join-lateral}
	*
	* @param table the query to join.
	*/
	crossJoinLateral = this.createJoin("cross", true);
	createSetOperator(type, isAll) {
		return (rightSelection) => {
			const rightSelect = typeof rightSelection === "function" ? rightSelection(getPgSetOperators()) : rightSelection;
			if (!haveSameKeys(this.getSelectedFields(), rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
			this.config.setOperators.push({
				type,
				isAll,
				rightSelect
			});
			return this;
		};
	}
	/**
	* Adds `union` set operator to the query.
	*
	* Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
	*
	* @example
	*
	* ```ts
	* // Select all unique names from customers and users tables
	* await db.select({ name: users.name })
	*   .from(users)
	*   .union(
	*     db.select({ name: customers.name }).from(customers)
	*   );
	* // or
	* import { union } from 'drizzle-orm/pg-core'
	*
	* await union(
	*   db.select({ name: users.name }).from(users),
	*   db.select({ name: customers.name }).from(customers)
	* );
	* ```
	*/
	union = this.createSetOperator("union", false);
	/**
	* Adds `union all` set operator to the query.
	*
	* Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
	*
	* @example
	*
	* ```ts
	* // Select all transaction ids from both online and in-store sales
	* await db.select({ transaction: onlineSales.transactionId })
	*   .from(onlineSales)
	*   .unionAll(
	*     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
	*   );
	* // or
	* import { unionAll } from 'drizzle-orm/pg-core'
	*
	* await unionAll(
	*   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
	*   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
	* );
	* ```
	*/
	unionAll = this.createSetOperator("union", true);
	/**
	* Adds `intersect` set operator to the query.
	*
	* Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
	*
	* @example
	*
	* ```ts
	* // Select course names that are offered in both departments A and B
	* await db.select({ courseName: depA.courseName })
	*   .from(depA)
	*   .intersect(
	*     db.select({ courseName: depB.courseName }).from(depB)
	*   );
	* // or
	* import { intersect } from 'drizzle-orm/pg-core'
	*
	* await intersect(
	*   db.select({ courseName: depA.courseName }).from(depA),
	*   db.select({ courseName: depB.courseName }).from(depB)
	* );
	* ```
	*/
	intersect = this.createSetOperator("intersect", false);
	/**
	* Adds `intersect all` set operator to the query.
	*
	* Calling this method will retain only the rows that are present in both result sets including all duplicates.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect-all}
	*
	* @example
	*
	* ```ts
	* // Select all products and quantities that are ordered by both regular and VIP customers
	* await db.select({
	*   productId: regularCustomerOrders.productId,
	*   quantityOrdered: regularCustomerOrders.quantityOrdered
	* })
	* .from(regularCustomerOrders)
	* .intersectAll(
	*   db.select({
	*     productId: vipCustomerOrders.productId,
	*     quantityOrdered: vipCustomerOrders.quantityOrdered
	*   })
	*   .from(vipCustomerOrders)
	* );
	* // or
	* import { intersectAll } from 'drizzle-orm/pg-core'
	*
	* await intersectAll(
	*   db.select({
	*     productId: regularCustomerOrders.productId,
	*     quantityOrdered: regularCustomerOrders.quantityOrdered
	*   })
	*   .from(regularCustomerOrders),
	*   db.select({
	*     productId: vipCustomerOrders.productId,
	*     quantityOrdered: vipCustomerOrders.quantityOrdered
	*   })
	*   .from(vipCustomerOrders)
	* );
	* ```
	*/
	intersectAll = this.createSetOperator("intersect", true);
	/**
	* Adds `except` set operator to the query.
	*
	* Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
	*
	* @example
	*
	* ```ts
	* // Select all courses offered in department A but not in department B
	* await db.select({ courseName: depA.courseName })
	*   .from(depA)
	*   .except(
	*     db.select({ courseName: depB.courseName }).from(depB)
	*   );
	* // or
	* import { except } from 'drizzle-orm/pg-core'
	*
	* await except(
	*   db.select({ courseName: depA.courseName }).from(depA),
	*   db.select({ courseName: depB.courseName }).from(depB)
	* );
	* ```
	*/
	except = this.createSetOperator("except", false);
	/**
	* Adds `except all` set operator to the query.
	*
	* Calling this method will retrieve all rows from the left query, except for the rows that are present in the result set of the right query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#except-all}
	*
	* @example
	*
	* ```ts
	* // Select all products that are ordered by regular customers but not by VIP customers
	* await db.select({
	*   productId: regularCustomerOrders.productId,
	*   quantityOrdered: regularCustomerOrders.quantityOrdered,
	* })
	* .from(regularCustomerOrders)
	* .exceptAll(
	*   db.select({
	*     productId: vipCustomerOrders.productId,
	*     quantityOrdered: vipCustomerOrders.quantityOrdered,
	*   })
	*   .from(vipCustomerOrders)
	* );
	* // or
	* import { exceptAll } from 'drizzle-orm/pg-core'
	*
	* await exceptAll(
	*   db.select({
	*     productId: regularCustomerOrders.productId,
	*     quantityOrdered: regularCustomerOrders.quantityOrdered
	*   })
	*   .from(regularCustomerOrders),
	*   db.select({
	*     productId: vipCustomerOrders.productId,
	*     quantityOrdered: vipCustomerOrders.quantityOrdered
	*   })
	*   .from(vipCustomerOrders)
	* );
	* ```
	*/
	exceptAll = this.createSetOperator("except", true);
	/** @internal */
	addSetOperators(setOperators) {
		this.config.setOperators.push(...setOperators);
		return this;
	}
	/**
	* Adds a `where` clause to the query.
	*
	* Calling this method will select only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#filtering}
	*
	* @param where the `where` clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be selected.
	*
	* ```ts
	* // Select all cars with green color
	* await db.select().from(cars).where(eq(cars.color, 'green'));
	* // or
	* await db.select().from(cars).where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Select all BMW cars with a green color
	* await db.select().from(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Select all cars with the green or blue color
	* await db.select().from(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		if (typeof where === "function") where = where(new Proxy(this.config.fields, new SelectionProxyHandler({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})));
		this.config.where = where;
		return this;
	}
	/**
	* Adds a `having` clause to the query.
	*
	* Calling this method will select only those rows that fulfill a specified condition. It is typically used with aggregate functions to filter the aggregated data based on a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#aggregations}
	*
	* @param having the `having` clause.
	*
	* @example
	*
	* ```ts
	* // Select all brands with more than one car
	* await db.select({
	* 	brand: cars.brand,
	* 	count: sql<number>`cast(count(${cars.id}) as int)`,
	* })
	*   .from(cars)
	*   .groupBy(cars.brand)
	*   .having(({ count }) => gt(count, 1));
	* ```
	*/
	having(having) {
		if (typeof having === "function") having = having(new Proxy(this.config.fields, new SelectionProxyHandler({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})));
		this.config.having = having;
		return this;
	}
	groupBy(...columns) {
		if (typeof columns[0] === "function") {
			const groupBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			this.config.groupBy = Array.isArray(groupBy) ? groupBy : [groupBy];
		} else this.config.groupBy = columns;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
			else this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
			else this.config.orderBy = orderByArray;
		}
		return this;
	}
	/**
	* Adds a `limit` clause to the query.
	*
	* Calling this method will set the maximum number of rows that will be returned by this query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
	*
	* @param limit the `limit` clause.
	*
	* @example
	*
	* ```ts
	* // Get the first 10 people from this query.
	* await db.select().from(people).limit(10);
	* ```
	*/
	limit(limit) {
		if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).limit = limit;
		else this.config.limit = limit;
		return this;
	}
	/**
	* Adds an `offset` clause to the query.
	*
	* Calling this method will skip a number of rows when returning results from this query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
	*
	* @param offset the `offset` clause.
	*
	* @example
	*
	* ```ts
	* // Get the 10th-20th people from this query.
	* await db.select().from(people).offset(10).limit(10);
	* ```
	*/
	offset(offset) {
		if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).offset = offset;
		else this.config.offset = offset;
		return this;
	}
	/**
	* Adds a `for` clause to the query.
	*
	* Calling this method will specify a lock strength for this query that controls how strictly it acquires exclusive access to the rows being queried.
	*
	* See docs: {@link https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE}
	*
	* @param strength the lock strength.
	* @param config the lock configuration.
	*/
	for(strength, config = {}) {
		this.config.lockingClause = {
			strength,
			config
		};
		return this;
	}
	/**
	* Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
	*/
	comment(comment) {
		this.config.comment = sql$1.comment(comment);
		return this;
	}
	getSQL() {
		return this.dialect.buildSelectQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	as(alias) {
		const usedTables = [];
		usedTables.push(...extractUsedTable$1(this.config.table));
		if (this.config.joins) for (const it of this.config.joins) usedTables.push(...extractUsedTable$1(it.table));
		return new Proxy(new Subquery(this.withoutSelectionCastCodecs().getSQL(), this.config.fields, alias, false, [...new Set(usedTables)]), new SelectionProxyHandler({
			alias,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	/** @internal */
	getSelectedFields() {
		return new Proxy(this.config.fields, new SelectionProxyHandler({
			alias: this.tableName,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		this.config.ignoreSelectionCastCodecs = true;
		return this;
	}
	$dynamic() {
		return this;
	}
	$withCache(config) {
		this.cacheConfig = config === void 0 ? {
			config: {},
			enabled: true,
			autoInvalidate: true
		} : config === false ? { enabled: false } : {
			enabled: true,
			autoInvalidate: true,
			...config
		};
		return this;
	}
};
function createSetOperator$1(type, isAll) {
	return (leftSelect, rightSelect, ...restSelects) => {
		const setOperators = [rightSelect, ...restSelects].map((select) => ({
			type,
			isAll,
			rightSelect: select
		}));
		for (const setOperator of setOperators) if (!haveSameKeys(leftSelect.getSelectedFields(), setOperator.rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
		return leftSelect.addSetOperators(setOperators);
	};
}
var getPgSetOperators = () => ({
	union: union$1,
	unionAll: unionAll$1,
	intersect: intersect$1,
	intersectAll,
	except: except$1,
	exceptAll
});
/**
* Adds `union` set operator to the query.
*
* Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
*
* @example
*
* ```ts
* // Select all unique names from customers and users tables
* import { union } from 'drizzle-orm/pg-core'
*
* await union(
*   db.select({ name: users.name }).from(users),
*   db.select({ name: customers.name }).from(customers)
* );
* // or
* await db.select({ name: users.name })
*   .from(users)
*   .union(
*     db.select({ name: customers.name }).from(customers)
*   );
* ```
*/
var union$1 = createSetOperator$1("union", false);
/**
* Adds `union all` set operator to the query.
*
* Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
*
* @example
*
* ```ts
* // Select all transaction ids from both online and in-store sales
* import { unionAll } from 'drizzle-orm/pg-core'
*
* await unionAll(
*   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
*   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
* );
* // or
* await db.select({ transaction: onlineSales.transactionId })
*   .from(onlineSales)
*   .unionAll(
*     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
*   );
* ```
*/
var unionAll$1 = createSetOperator$1("union", true);
/**
* Adds `intersect` set operator to the query.
*
* Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
*
* @example
*
* ```ts
* // Select course names that are offered in both departments A and B
* import { intersect } from 'drizzle-orm/pg-core'
*
* await intersect(
*   db.select({ courseName: depA.courseName }).from(depA),
*   db.select({ courseName: depB.courseName }).from(depB)
* );
* // or
* await db.select({ courseName: depA.courseName })
*   .from(depA)
*   .intersect(
*     db.select({ courseName: depB.courseName }).from(depB)
*   );
* ```
*/
var intersect$1 = createSetOperator$1("intersect", false);
/**
* Adds `intersect all` set operator to the query.
*
* Calling this method will retain only the rows that are present in both result sets including all duplicates.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect-all}
*
* @example
*
* ```ts
* // Select all products and quantities that are ordered by both regular and VIP customers
* import { intersectAll } from 'drizzle-orm/pg-core'
*
* await intersectAll(
*   db.select({
*     productId: regularCustomerOrders.productId,
*     quantityOrdered: regularCustomerOrders.quantityOrdered
*   })
*   .from(regularCustomerOrders),
*   db.select({
*     productId: vipCustomerOrders.productId,
*     quantityOrdered: vipCustomerOrders.quantityOrdered
*   })
*   .from(vipCustomerOrders)
* );
* // or
* await db.select({
*   productId: regularCustomerOrders.productId,
*   quantityOrdered: regularCustomerOrders.quantityOrdered
* })
* .from(regularCustomerOrders)
* .intersectAll(
*   db.select({
*     productId: vipCustomerOrders.productId,
*     quantityOrdered: vipCustomerOrders.quantityOrdered
*   })
*   .from(vipCustomerOrders)
* );
* ```
*/
var intersectAll = createSetOperator$1("intersect", true);
/**
* Adds `except` set operator to the query.
*
* Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
*
* @example
*
* ```ts
* // Select all courses offered in department A but not in department B
* import { except } from 'drizzle-orm/pg-core'
*
* await except(
*   db.select({ courseName: depA.courseName }).from(depA),
*   db.select({ courseName: depB.courseName }).from(depB)
* );
* // or
* await db.select({ courseName: depA.courseName })
*   .from(depA)
*   .except(
*     db.select({ courseName: depB.courseName }).from(depB)
*   );
* ```
*/
var except$1 = createSetOperator$1("except", false);
/**
* Adds `except all` set operator to the query.
*
* Calling this method will retrieve all rows from the left query, except for the rows that are present in the result set of the right query.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#except-all}
*
* @example
*
* ```ts
* // Select all products that are ordered by regular customers but not by VIP customers
* import { exceptAll } from 'drizzle-orm/pg-core'
*
* await exceptAll(
*   db.select({
*     productId: regularCustomerOrders.productId,
*     quantityOrdered: regularCustomerOrders.quantityOrdered
*   })
*   .from(regularCustomerOrders),
*   db.select({
*     productId: vipCustomerOrders.productId,
*     quantityOrdered: vipCustomerOrders.quantityOrdered
*   })
*   .from(vipCustomerOrders)
* );
* // or
* await db.select({
*   productId: regularCustomerOrders.productId,
*   quantityOrdered: regularCustomerOrders.quantityOrdered,
* })
* .from(regularCustomerOrders)
* .exceptAll(
*   db.select({
*     productId: vipCustomerOrders.productId,
*     quantityOrdered: vipCustomerOrders.quantityOrdered,
*   })
*   .from(vipCustomerOrders)
* );
* ```
*/
var exceptAll = createSetOperator$1("except", true);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/dialect.js
var PgDialect = class {
	static [entityKind] = "PgDialect";
	codecs;
	mapperGenerators;
	constructor(config) {
		this.codecs = new CodecsCollection(resolvePgTypeAlias, config?.codecs);
		this.mapperGenerators = config?.useJitMappers ? {
			rows: makeJitQueryMapper,
			relationalRows: makeJitRqbMapper
		} : {
			rows: makeDefaultQueryMapper,
			relationalRows: makeDefaultRqbMapper
		};
	}
	escapeName(name) {
		return `"${name.replace(/"/g, "\"\"")}"`;
	}
	escapeParam(num) {
		return `$${num + 1}`;
	}
	escapeString(str) {
		return `'${str.replace(/'/g, "''")}'`;
	}
	buildWithCTE(queries) {
		if (!queries?.length) return void 0;
		const withSqlChunks = [sql$1`with `];
		for (const [i, w] of queries.entries()) {
			withSqlChunks.push(sql$1`${sql$1.identifier(w._.alias)} as (${w._.sql})`);
			if (i < queries.length - 1) withSqlChunks.push(sql$1`, `);
		}
		withSqlChunks.push(sql$1` `);
		return sql$1.join(withSqlChunks);
	}
	buildDeleteQuery({ table, where, returning, withList, comment, ignoreSelectionCastCodecs }) {
		const withSql = this.buildWithCTE(withList);
		const returningSql = returning ? sql$1` returning ${this.buildSelection(returning, {
			isSingleTable: true,
			ignoreCastCodecs: ignoreSelectionCastCodecs
		})}` : void 0;
		return sql$1`${withSql}delete from ${table}${where ? sql$1` where ${where}` : void 0}${returningSql}${comment !== void 0 ? sql$1` ${comment}` : void 0}`;
	}
	buildUpdateSet(table, set) {
		const tableColumns = table[Table.Symbol.Columns];
		const columnNames = Object.keys(tableColumns).filter((colName) => set[colName] !== void 0 || tableColumns[colName]?.onUpdateFn !== void 0);
		const setLength = columnNames.length;
		return sql$1.join(columnNames.flatMap((colName, i) => {
			const col = tableColumns[colName];
			const onUpdateFnResult = col.onUpdateFn?.();
			const value = set[colName] ?? (is(onUpdateFnResult, SQL$1) ? onUpdateFnResult : sql$1.param(onUpdateFnResult, col));
			const res = sql$1`${sql$1.identifier(col.name)} = ${value}`;
			if (i < setLength - 1) return [res, sql$1.raw(", ")];
			return [res];
		}));
	}
	buildUpdateQuery({ table, set, where, returning, withList, from, joins, comment, ignoreSelectionCastCodecs }) {
		const withSql = this.buildWithCTE(withList);
		const tableName = table[PgTable.Symbol.Name];
		const tableSchema = table[PgTable.Symbol.Schema];
		const origTableName = table[PgTable.Symbol.OriginalName];
		const alias = tableName === origTableName ? void 0 : tableName;
		const tableSql = sql$1`${tableSchema ? sql$1`${sql$1.identifier(tableSchema)}.` : void 0}${sql$1.identifier(origTableName)}${alias && sql$1` ${sql$1.identifier(alias)}`}`;
		const setSql = this.buildUpdateSet(table, set);
		const fromSql = from && sql$1.join([sql$1.raw(" from "), this.buildFromTable(from)]);
		const joinsSql = this.buildJoins(joins);
		const returningSql = returning ? sql$1` returning ${this.buildSelection(returning, {
			isSingleTable: !from,
			ignoreCastCodecs: ignoreSelectionCastCodecs
		})}` : void 0;
		return sql$1`${withSql}update ${tableSql} set ${setSql}${fromSql}${joinsSql}${where ? sql$1` where ${where}` : void 0}${returningSql}${comment !== void 0 ? sql$1` ${comment}` : void 0}`;
	}
	/**
	* Builds selection SQL with provided fields/expressions
	*
	* Examples:
	*
	* `select <selection> from`
	*
	* `insert ... returning <selection>`
	*
	* If `isSingleTable` is true, then columns won't be prefixed with table name
	*/
	buildSelection(fields, { isSingleTable = false, ignoreCastCodecs = false } = {}) {
		const columnsLen = fields.length;
		const chunks = fields.flatMap(({ field }, i) => {
			const chunk = [];
			if (is(field, SQL$1.Aliased) && field.isSelectionField) {
				const column = ignoreCastCodecs ? void 0 : getColumnFromDecoder(field);
				const query = !isSingleTable && field.origin !== void 0 ? sql$1`${sql$1.identifier(field.origin)}.${sql$1.identifier(field.fieldAlias)}` : sql$1.identifier(field.fieldAlias);
				if (!column) chunk.push(query);
				else chunk.push(this.codecs.apply(column, "cast", query));
			} else if (is(field, SQL$1.Aliased) || is(field, SQL$1)) {
				const query = is(field, SQL$1.Aliased) ? field.sql : field;
				const column = ignoreCastCodecs ? void 0 : getColumnFromDecoder(query);
				if (isSingleTable) {
					const newSql = new SQL$1(query.queryChunks.map((c) => {
						if (is(c, PgColumn)) return sql$1.identifier(c.name);
						return c;
					}));
					if (query.shouldInlineParams) newSql.inlineParams();
					const wrapped = column ? this.codecs.apply(column, "cast", newSql) : newSql;
					chunk.push(wrapped);
				} else chunk.push(column ? this.codecs.apply(column, "cast", query) : query);
				if (is(field, SQL$1.Aliased)) chunk.push(sql$1` as ${sql$1.identifier(field.fieldAlias)}`);
			} else if (is(field, Column)) {
				let name;
				if (isSingleTable) name = field.isAlias ? sql$1.identifier(getOriginalColumnFromAlias(field).name) : sql$1.identifier(field.name);
				else name = field.isAlias ? getOriginalColumnFromAlias(field) : field;
				const casted = ignoreCastCodecs ? name : this.codecs.apply(field, "cast", name);
				chunk.push(field.isAlias ? sql$1`${casted} as ${field}` : casted);
			} else if (is(field, Subquery)) {
				const entries = Object.entries(field._.selectedFields);
				let column;
				if (entries.length === 1) {
					const entry = entries[0][1];
					let fieldDecoder;
					if (is(entry, Column)) {
						column = entry;
						fieldDecoder = entry;
					} else if (is(entry, SQL$1)) {
						column = !ignoreCastCodecs ? getColumnFromDecoder(entry) : void 0;
						fieldDecoder = entry.decoder;
					} else {
						column = !ignoreCastCodecs ? getColumnFromDecoder(entry) : void 0;
						fieldDecoder = entry.sql.decoder;
					}
					if (fieldDecoder) field._.sql.decoder = fieldDecoder;
				}
				chunk.push(column ? this.codecs.apply(column, "cast", field) : field);
			}
			if (i < columnsLen - 1) chunk.push(sql$1`, `);
			return chunk;
		});
		return sql$1.join(chunks);
	}
	buildJoins(joins) {
		if (!joins || joins.length === 0) return;
		const joinsArray = [];
		for (const [index, joinMeta] of joins.entries()) {
			if (index === 0) joinsArray.push(sql$1` `);
			const table = joinMeta.table;
			const lateralSql = joinMeta.lateral ? sql$1` lateral` : void 0;
			const onSql = joinMeta.on ? sql$1` on ${joinMeta.on}` : void 0;
			if (is(table, PgTable)) {
				const tableName = table[PgTable.Symbol.Name];
				const tableSchema = table[PgTable.Symbol.Schema];
				const origTableName = table[PgTable.Symbol.OriginalName];
				const alias = tableName === origTableName ? void 0 : joinMeta.alias;
				joinsArray.push(sql$1`${sql$1.raw(joinMeta.joinType)} join${lateralSql} ${tableSchema ? sql$1`${sql$1.identifier(tableSchema)}.` : void 0}${sql$1.identifier(origTableName)}${alias && sql$1` ${sql$1.identifier(alias)}`}${onSql}`);
			} else if (is(table, View)) {
				const viewName = table[ViewBaseConfig].name;
				const viewSchema = table[ViewBaseConfig].schema;
				const origViewName = table[ViewBaseConfig].originalName;
				const alias = viewName === origViewName ? void 0 : joinMeta.alias;
				joinsArray.push(sql$1`${sql$1.raw(joinMeta.joinType)} join${lateralSql} ${viewSchema ? sql$1`${sql$1.identifier(viewSchema)}.` : void 0}${sql$1.identifier(origViewName)}${alias && sql$1` ${sql$1.identifier(alias)}`}${onSql}`);
			} else joinsArray.push(sql$1`${sql$1.raw(joinMeta.joinType)} join${lateralSql} ${table}${onSql}`);
			if (index < joins.length - 1) joinsArray.push(sql$1` `);
		}
		return sql$1.join(joinsArray);
	}
	buildFromTable(table) {
		if (is(table, Table) && table[Table.Symbol.IsAlias]) {
			let fullName = sql$1`${sql$1.identifier(table[Table.Symbol.OriginalName])}`;
			if (table[Table.Symbol.Schema]) fullName = sql$1`${sql$1.identifier(table[Table.Symbol.Schema])}.${fullName}`;
			return sql$1`${fullName} ${sql$1.identifier(table[Table.Symbol.Name])}`;
		}
		if (is(table, View) && table[ViewBaseConfig].isAlias) {
			let fullName = sql$1`${sql$1.identifier(table[ViewBaseConfig].originalName)}`;
			if (table[ViewBaseConfig].schema) fullName = sql$1`${sql$1.identifier(table[ViewBaseConfig].schema)}.${fullName}`;
			return sql$1`${fullName} ${sql$1.identifier(table[ViewBaseConfig].name)}`;
		}
		return table;
	}
	buildSelectQuery({ withList, fields, fieldsFlat, where, having, table, joins, orderBy, groupBy, limit, offset, lockingClause, distinct, setOperators, comment, ignoreSelectionCastCodecs }) {
		const fieldsList = fieldsFlat ?? orderSelectedFields(fields, void 0, this.codecs);
		for (const f of fieldsList) if (is(f.field, Column) && getTableName(f.field.table) !== (is(table, Subquery) ? table._.alias : is(table, PgViewBase) ? table[ViewBaseConfig].name : is(table, SQL$1) ? void 0 : getTableName(table)) && !((table) => joins?.some(({ alias }) => alias === (table[Table.Symbol.IsAlias] ? getTableName(table) : table[Table.Symbol.BaseName])))(f.field.table)) {
			const tableName = getTableName(f.field.table);
			throw new Error(`Your "${f.path.join("->")}" field references a column "${tableName}"."${f.field.name}", but the table "${tableName}" is not part of the query! Did you forget to join it?`);
		}
		const isSingleTable = !joins || joins.length === 0;
		const withSql = this.buildWithCTE(withList);
		let distinctSql;
		if (distinct) distinctSql = distinct === true ? sql$1` distinct` : sql$1` distinct on (${sql$1.join(distinct.on, sql$1`, `)})`;
		const selection = this.buildSelection(fieldsList, {
			isSingleTable,
			ignoreCastCodecs: ignoreSelectionCastCodecs
		});
		const tableSql = this.buildFromTable(table);
		const joinsSql = this.buildJoins(joins);
		const whereSql = where ? sql$1` where ${where}` : void 0;
		const havingSql = having ? sql$1` having ${having}` : void 0;
		let orderBySql;
		if (orderBy && orderBy.length > 0) orderBySql = sql$1` order by ${sql$1.join(orderBy, sql$1`, `)}`;
		let groupBySql;
		if (groupBy && groupBy.length > 0) groupBySql = sql$1` group by ${sql$1.join(groupBy, sql$1`, `)}`;
		const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql$1` limit ${limit}` : void 0;
		const offsetSql = offset ? sql$1` offset ${offset}` : void 0;
		const lockingClauseSql = sql$1.empty();
		if (lockingClause) {
			const clauseSql = sql$1` for ${sql$1.raw(lockingClause.strength)}`;
			if (lockingClause.config.of) clauseSql.append(sql$1` of ${sql$1.join(Array.isArray(lockingClause.config.of) ? lockingClause.config.of.map((it) => sql$1.identifier(it[PgTable.Symbol.Name])) : [sql$1.identifier(lockingClause.config.of[PgTable.Symbol.Name])], sql$1`, `)}`);
			if (lockingClause.config.noWait) clauseSql.append(sql$1` nowait`);
			else if (lockingClause.config.skipLocked) clauseSql.append(sql$1` skip locked`);
			lockingClauseSql.append(clauseSql);
		}
		const finalQuery = sql$1`${withSql}select${distinctSql} ${selection} from ${tableSql}${joinsSql}${whereSql}${groupBySql}${havingSql}${orderBySql}${limitSql}${offsetSql}${lockingClauseSql}${comment !== void 0 ? sql$1` ${comment}` : void 0}`;
		if (setOperators.length > 0) return this.buildSetOperations(finalQuery, setOperators);
		return finalQuery;
	}
	buildSetOperations(leftSelect, setOperators) {
		const [setOperator, ...rest] = setOperators;
		if (!setOperator) throw new Error("Cannot pass undefined values to any set operator");
		if (rest.length === 0) return this.buildSetOperationQuery({
			leftSelect,
			setOperator
		});
		return this.buildSetOperations(this.buildSetOperationQuery({
			leftSelect,
			setOperator
		}), rest);
	}
	buildSetOperationQuery({ leftSelect, setOperator: { type, isAll, rightSelect, limit, orderBy, offset } }) {
		const leftChunk = sql$1`(${leftSelect.getSQL()}) `;
		const rightChunk = sql$1`(${rightSelect.getSQL()})`;
		let orderBySql;
		if (orderBy && orderBy.length > 0) {
			const orderByValues = [];
			for (const singleOrderBy of orderBy) if (is(singleOrderBy, PgColumn)) orderByValues.push(sql$1.identifier(singleOrderBy.name));
			else if (is(singleOrderBy, SQL$1)) {
				for (let i = 0; i < singleOrderBy.queryChunks.length; i++) {
					const chunk = singleOrderBy.queryChunks[i];
					if (is(chunk, PgColumn)) singleOrderBy.queryChunks[i] = sql$1.identifier(chunk.name);
				}
				orderByValues.push(sql$1`${singleOrderBy}`);
			} else orderByValues.push(sql$1`${singleOrderBy}`);
			orderBySql = sql$1` order by ${sql$1.join(orderByValues, sql$1`, `)} `;
		}
		const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql$1` limit ${limit}` : void 0;
		const operatorChunk = sql$1.raw(`${type} ${isAll ? "all " : ""}`);
		const offsetSql = offset ? sql$1` offset ${offset}` : void 0;
		return sql$1`${leftChunk}${operatorChunk}${rightChunk}${orderBySql}${limitSql}${offsetSql}`;
	}
	buildInsertQuery({ table, values: valuesOrSelect, onConflict, returning, withList, select, overridingSystemValue_, comment, ignoreSelectionCastCodecs }) {
		const valuesSqlList = [];
		const columns = table[Table.Symbol.Columns];
		const colEntries = Object.entries(columns).filter(([_, col]) => !col.shouldDisableInsert());
		const insertOrder = colEntries.map(([, column]) => sql$1.identifier(column.name));
		if (select) {
			const select = valuesOrSelect;
			if (is(select, SQL$1)) valuesSqlList.push(select);
			else valuesSqlList.push(select.getSQL());
		} else {
			const values = valuesOrSelect;
			valuesSqlList.push(sql$1.raw("values "));
			for (const [valueIndex, value] of values.entries()) {
				const valueList = [];
				for (const [fieldName, col] of colEntries) {
					const colValue = value[fieldName];
					if (colValue === void 0 || is(colValue, Param) && colValue.value === void 0) if (col.defaultFn !== void 0) {
						const defaultFnResult = col.defaultFn();
						const defaultValue = is(defaultFnResult, SQL$1) ? defaultFnResult : sql$1.param(defaultFnResult, col);
						valueList.push(defaultValue);
					} else if (!col.default && col.onUpdateFn !== void 0) {
						const onUpdateFnResult = col.onUpdateFn();
						const newValue = is(onUpdateFnResult, SQL$1) ? onUpdateFnResult : sql$1.param(onUpdateFnResult, col);
						valueList.push(newValue);
					} else valueList.push(sql$1`default`);
					else valueList.push(colValue);
				}
				valuesSqlList.push(valueList);
				if (valueIndex < values.length - 1) valuesSqlList.push(sql$1`, `);
			}
		}
		const withSql = this.buildWithCTE(withList);
		const valuesSql = sql$1.join(valuesSqlList);
		const returningSql = returning ? sql$1` returning ${this.buildSelection(returning, {
			isSingleTable: true,
			ignoreCastCodecs: ignoreSelectionCastCodecs
		})}` : void 0;
		const onConflictSql = onConflict ? sql$1` on conflict ${onConflict}` : void 0;
		return sql$1`${withSql}insert into ${table} ${insertOrder} ${overridingSystemValue_ === true ? sql$1`overriding system value ` : void 0}${valuesSql}${onConflictSql}${returningSql}${comment !== void 0 ? sql$1` ${comment}` : void 0}`;
	}
	buildRefreshMaterializedViewQuery({ view, concurrently, withNoData }) {
		return sql$1`refresh materialized view${concurrently ? sql$1` concurrently` : void 0} ${view}${withNoData ? sql$1` with no data` : void 0}`;
	}
	sqlToQuery(sql, invokeSource) {
		return sql.toQuery({
			escapeName: this.escapeName,
			escapeParam: this.escapeParam,
			escapeString: this.escapeString,
			codecs: this.codecs,
			invokeSource
		});
	}
	_sqlToQuery(sql) {
		return sql.toQuery({
			escapeName: this.escapeName,
			escapeParam: this.escapeParam,
			escapeString: this.escapeString,
			codecs: this.codecs,
			tagged: true
		});
	}
	nestedSelectionerror() {
		throw new DrizzleError({ message: `Views with nested selections are not supported by the relational query builder` });
	}
	buildRqbColumn(table, field, key, inJson) {
		if (is(field, Column)) {
			const name = sql$1`${table}.${sql$1.identifier(field.name)}`;
			return sql$1`${inJson && field.jsonSelectIdentifier ? field.jsonSelectIdentifier(name, sql$1, field.dimensions) : this.codecs.apply(field, inJson ? "castInJson" : "cast", name)} as ${sql$1.identifier(key)}`;
		}
		if (is(field, SQL$1.Aliased)) {
			const column = getColumnFromDecoder(field);
			const q = sql$1`${table}.${sql$1.identifier(field.fieldAlias)}`;
			return sql$1`${column ? this.codecs.apply(column, inJson ? "castInJson" : "cast", q) : q} as ${sql$1.identifier(key)}`;
		}
		if (isSQLWrapper(field)) {
			const column = getColumnFromDecoder(field);
			const q = sql$1`${table}.${sql$1.identifier(key)}`;
			return sql$1`${column ? this.codecs.apply(column, inJson ? "castInJson" : "cast", q) : q} as ${sql$1.identifier(key)}`;
		}
		throw this.nestedSelectionerror();
	}
	resolveSelection(field, key, inJson) {
		if (is(field, Column)) return {
			key,
			field,
			codec: this.codecs.get(field, inJson ? "normalizeInJson" : "normalize"),
			arrayDimensions: field.dimensions
		};
		const decoderColumn = getColumnFromDecoder(field);
		return decoderColumn ? {
			key,
			field,
			codec: decoderColumn && (!inJson || !decoderColumn.mapFromJsonValue) ? this.codecs.get(decoderColumn, inJson ? "normalizeInJson" : "normalize") : void 0,
			arrayDimensions: decoderColumn.dimensions
		} : {
			key,
			field
		};
	}
	unwrapAllColumns = (table, selection, inJson) => {
		return sql$1.join(Object.entries(table[TableColumns]).map(([k, v]) => {
			selection.push(this.resolveSelection(v, k, inJson));
			return this.buildRqbColumn(table, v, k, inJson);
		}), sql$1`, `);
	};
	buildColumns = (table, selection, inJson, config) => config?.columns ? (() => {
		const entries = Object.entries(config.columns);
		const columnContainer = table[TableColumns];
		const columnIdentifiers = [];
		let colSelectionMode;
		for (const [k, v] of entries) {
			if (v === void 0) continue;
			colSelectionMode = colSelectionMode || v;
			if (v) {
				const column = columnContainer[k];
				columnIdentifiers.push(this.buildRqbColumn(table, column, k, inJson));
				selection.push(this.resolveSelection(column, k, inJson));
			}
		}
		if (colSelectionMode === false) for (const [k, v] of Object.entries(columnContainer)) {
			if (config.columns[k] === false) continue;
			columnIdentifiers.push(this.buildRqbColumn(table, v, k, inJson));
			selection.push(this.resolveSelection(v, k, inJson));
		}
		return columnIdentifiers.length ? sql$1.join(columnIdentifiers, sql$1`, `) : void 0;
	})() : this.unwrapAllColumns(table, selection, inJson);
	buildRelationalQuery({ schema, table, tableConfig, queryConfig: config, relationWhere, mode, errorPath, depth, throughJoin, nested }) {
		const selection = [];
		const isSingle = mode === "first";
		const params = config === true ? void 0 : config;
		const currentPath = errorPath ?? "";
		const currentDepth = depth ?? 0;
		if (!currentDepth) table = aliasedTable(table, `d${currentDepth}`);
		const limit = isSingle ? 1 : params?.limit;
		const offset = params?.offset;
		const where = params?.where && relationWhere ? and(relationsFilterToSQL(table, params.where, tableConfig.relations, schema), relationWhere) : params?.where ? relationsFilterToSQL(table, params.where, tableConfig.relations, schema) : relationWhere;
		const order = params?.orderBy ? relationsOrderToSQL(table, params.orderBy) : void 0;
		const columns = this.buildColumns(table, selection, !!nested, params);
		const extras = params?.extras ? relationExtrasToSQL(table, params.extras, this.codecs, nested) : void 0;
		if (extras) selection.push(...extras.selection);
		const selectionArr = columns ? [columns] : [];
		if (extras?.sql) selectionArr.push(extras.sql);
		const joins = params ? (() => {
			const { with: joins } = params;
			if (!joins) return;
			const withEntries = Object.entries(joins).filter(([_, v]) => v);
			if (!withEntries.length) return;
			return sql$1.join(withEntries.map(([k, join]) => {
				const relation = tableConfig.relations[k];
				const isSingle = is(relation, One$1);
				const targetTable = aliasedTable(relation.targetTable, `d${currentDepth + 1}`);
				const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `tr${currentDepth}`) : void 0;
				const { filter, joinCondition } = relationToSQL(relation, table, targetTable, throughTable);
				selectionArr.push(sql$1`${sql$1.identifier(k)}.${sql$1.identifier("r")} as ${sql$1.identifier(k)}`);
				const throughJoin = throughTable ? sql$1` inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}` : void 0;
				const innerQuery = this.buildRelationalQuery({
					table: targetTable,
					mode: isSingle ? "first" : "many",
					schema,
					queryConfig: join,
					tableConfig: schema[relation.targetTableName],
					relationWhere: filter,
					errorPath: `${currentPath.length ? `${currentPath}.` : ""}${k}`,
					depth: currentDepth + 1,
					throughJoin,
					nested: true
				});
				selection.push({
					field: targetTable,
					key: k,
					selection: innerQuery.selection,
					isArray: !isSingle,
					isOptional: (relation.optional ?? false) || join !== true && !!join.where
				});
				return sql$1`left join lateral(select ${isSingle ? sql$1`row_to_json(${sql$1.identifier("t")}.*) ${sql$1.identifier("r")}` : sql$1`coalesce(json_agg(row_to_json(${sql$1.identifier("t")}.*)), '[]') as ${sql$1.identifier("r")}`} from (${innerQuery.sql}) as ${sql$1.identifier("t")}) as ${sql$1.identifier(k)} on true`;
			}), sql$1` `);
		})() : void 0;
		if (!selectionArr.length) throw new DrizzleError({ message: `No fields selected for table "${tableConfig.name}"${currentPath ? ` ("${currentPath}")` : ""}` });
		const selectionSet = sql$1.join(selectionArr.filter((e) => e !== void 0), sql$1`, `);
		const comment = config !== true && config?.comment ? sql$1.comment(config.comment) : void 0;
		return {
			sql: sql$1`select ${selectionSet} from ${getTableAsAliasSQL(table)}${throughJoin}${joins ? sql$1` ${joins}` : void 0}${where ? sql$1` where ${where}` : void 0}${order ? sql$1` order by ${order}` : void 0}${limit !== void 0 ? sql$1` limit ${limit}` : void 0}${offset !== void 0 ? sql$1` offset ${offset}` : void 0}${comment ? sql$1` ${comment}` : void 0}`,
			selection
		};
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/query-builder.js
var QueryBuilder$1 = class {
	static [entityKind] = "PgQueryBuilder";
	dialect;
	dialectConfig;
	constructor(dialect) {
		this.dialect = is(dialect, PgDialect) ? dialect : void 0;
		this.dialectConfig = is(dialect, PgDialect) ? void 0 : dialect;
	}
	$with = (alias, selection) => {
		const queryBuilder = this;
		const as = (qb) => {
			if (typeof qb === "function") qb = qb(queryBuilder);
			const sql = ("withoutSelectionCastCodecs" in qb ? qb.withoutSelectionCastCodecs() : qb).getSQL();
			return new Proxy(new WithSubquery(sql, selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true, sql.usedTables ?? []), new SelectionProxyHandler({
				alias,
				sqlAliasedBehavior: "alias",
				sqlBehavior: "error"
			}));
		};
		return { as };
	};
	with(...queries) {
		const self = this;
		function select(fields) {
			return new PgSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				withList: queries
			});
		}
		function selectDistinct(fields) {
			return new PgSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				distinct: true
			});
		}
		function selectDistinctOn(on, fields) {
			return new PgSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				distinct: { on }
			});
		}
		return {
			select,
			selectDistinct,
			selectDistinctOn
		};
	}
	select(fields) {
		return new PgSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect()
		});
	}
	selectDistinct(fields) {
		return new PgSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect(),
			distinct: true
		});
	}
	selectDistinctOn(on, fields) {
		return new PgSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect(),
			distinct: { on }
		});
	}
	getDialect() {
		if (!this.dialect) this.dialect = new PgDialect(this.dialectConfig);
		return this.dialect;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/insert.js
var PgInsertBuilder = class {
	static [entityKind] = "PgInsertBuilder";
	constructor(table, session, dialect, withList, overridingSystemValue_, builder = PgInsertBase) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.withList = withList;
		this.overridingSystemValue_ = overridingSystemValue_;
		this.builder = builder;
	}
	/** @internal */
	authToken;
	/** @internal */
	setToken(token) {
		this.authToken = token;
		return this;
	}
	overridingSystemValue() {
		this.overridingSystemValue_ = true;
		return this;
	}
	values(values) {
		values = Array.isArray(values) ? values : [values];
		if (values.length === 0) throw new Error("values() must be called with at least one value");
		const mappedValues = values.map((entry) => {
			const result = {};
			const cols = this.table[Table.Symbol.Columns];
			for (const colKey of Object.keys(entry)) {
				const colValue = entry[colKey];
				result[colKey] = is(colValue, SQL$1) ? colValue : new Param(colValue, cols[colKey]);
			}
			return result;
		});
		const builder = new this.builder(this.table, mappedValues, this.session, this.dialect, this.withList, false, this.overridingSystemValue_);
		if ("setToken" in builder) builder.setToken(this.authToken);
		return builder;
	}
	select(selectQuery) {
		const select = typeof selectQuery === "function" ? selectQuery(new QueryBuilder$1()) : selectQuery;
		if ("withoutSelectionCastCodecs" in select) select.withoutSelectionCastCodecs();
		if (!is(select, SQL$1) && !haveSameKeys(this.table[TableColumns], select._.selectedFields)) throw new Error("Insert select error: selected fields are not the same or are in a different order compared to the table definition");
		const builder = new this.builder(this.table, select, this.session, this.dialect, this.withList, true);
		if ("setToken" in builder) builder.setToken(this.authToken);
		return builder;
	}
};
var PgInsertBase = class {
	static [entityKind] = "PgInsert";
	config;
	cacheConfig;
	constructor(table, values, session, dialect, withList, select, overridingSystemValue_) {
		this.session = session;
		this.dialect = dialect;
		this.config = {
			table,
			values,
			withList,
			select,
			overridingSystemValue_
		};
	}
	returning(fields = this.config.table[Table.Symbol.Columns]) {
		this.config.returningFields = fields;
		this.config.returning = orderSelectedFields(this.config.returningFields, void 0, this.dialect.codecs);
		return this;
	}
	/**
	* Adds an `on conflict do nothing` clause to the query.
	*
	* Calling this method simply avoids inserting a row as its alternative action.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert#on-conflict-do-nothing}
	*
	* @param config The `target` and `where` clauses.
	*
	* @example
	* ```ts
	* // Insert one row and cancel the insert if there's a conflict
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoNothing();
	*
	* // Explicitly specify conflict target
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoNothing({ target: cars.id });
	* ```
	*/
	onConflictDoNothing(config = {}) {
		if (config.target === void 0) this.config.onConflict = sql$1`do nothing`;
		else {
			let targetColumn = "";
			targetColumn = Array.isArray(config.target) ? config.target.map((it) => this.dialect.escapeName(it.name)).join(",") : this.dialect.escapeName(config.target.name);
			const whereSql = config.where ? sql$1` where ${config.where}` : void 0;
			this.config.onConflict = sql$1`(${sql$1.raw(targetColumn)})${whereSql} do nothing`;
		}
		return this;
	}
	/**
	* Adds an `on conflict do update` clause to the query.
	*
	* Calling this method will update the existing row that conflicts with the row proposed for insertion as its alternative action.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert#upserts-and-conflicts}
	*
	* @param config The `target`, `set` and `where` clauses.
	*
	* @example
	* ```ts
	* // Update the row if there's a conflict
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoUpdate({
	*     target: cars.id,
	*     set: { brand: 'Porsche' }
	*   });
	*
	* // Upsert with 'where' clause
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoUpdate({
	*     target: cars.id,
	*     set: { brand: 'newBMW' },
	*     targetWhere: sql`${cars.createdAt} > '2023-01-01'::date`,
	*   });
	* ```
	*/
	onConflictDoUpdate(config) {
		if (config.where && (config.targetWhere || config.setWhere)) throw new Error("You cannot use both \"where\" and \"targetWhere\"/\"setWhere\" at the same time - \"where\" is deprecated, use \"targetWhere\" or \"setWhere\" instead.");
		const whereSql = config.where ? sql$1` where ${config.where}` : void 0;
		const targetWhereSql = config.targetWhere ? sql$1` where ${config.targetWhere}` : void 0;
		const setWhereSql = config.setWhere ? sql$1` where ${config.setWhere}` : void 0;
		const setSql = this.dialect.buildUpdateSet(this.config.table, mapUpdateSet(this.config.table, config.set));
		let targetColumn = "";
		targetColumn = Array.isArray(config.target) ? config.target.map((it) => this.dialect.escapeName(it.name)).join(",") : this.dialect.escapeName(config.target.name);
		this.config.onConflict = sql$1`(${sql$1.raw(targetColumn)})${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}`;
		return this;
	}
	/**
	* Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
	*/
	comment(comment) {
		this.config.comment = sql$1.comment(comment);
		return this;
	}
	getSQL() {
		return this.dialect.buildInsertQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	/** @internal */
	getSelectedFields() {
		return this.config.returningFields ? new Proxy(this.config.returningFields, new SelectionProxyHandler({
			alias: getTableName(this.config.table),
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		})) : void 0;
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		this.config.ignoreSelectionCastCodecs = true;
		return this;
	}
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/insert.js
var PgAsyncInsertBase = class extends PgInsertBase {
	static [entityKind] = "PgAsyncInsert";
	/** @internal */
	_prepare(name, generateName = false) {
		const { session, config, dialect, cacheConfig } = this;
		const { returning: fields } = config;
		return tracer.startActiveSpan("drizzle.prepareQuery", () => {
			const query = dialect.sqlToQuery(this.getSQL());
			const mapper = fields ? this.dialect.mapperGenerators.rows(fields, void 0) : void 0;
			return session.prepareQuery(query, fields ? "arrays" : "raw", name ?? generateName, mapper, {
				type: "insert",
				tables: [...extractUsedTable$1(this.config.table)]
			}, cacheConfig);
		});
	}
	prepare(name) {
		return this._prepare(name, true);
	}
	execute = (placeholderValues) => {
		return tracer.startActiveSpan("drizzle.operation", () => {
			return this._prepare().execute(placeholderValues);
		});
	};
};
applyMixins(PgAsyncInsertBase, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/query.js
var PgAsyncRelationalQuery = class extends PgRelationalQuery {
	static [entityKind] = "PgAsyncRelationalQueryV2";
	/** @internal */
	_prepare(name, generateName = false) {
		return tracer.startActiveSpan("drizzle.prepareQuery", () => {
			const { query, builtQuery } = this._toSQL();
			const mapper = this.dialect.mapperGenerators.relationalRows({
				isFirst: this.mode === "first",
				parseJson: this.parseJson,
				parseJsonIfString: false,
				rootJsonMappers: false,
				selection: query.selection,
				arrayModeRoot: true
			});
			return this.session.prepareQuery(builtQuery, "arrays", name ?? generateName, mapper);
		});
	}
	prepare(name) {
		return this._prepare(name, true);
	}
	execute(placeholderValues) {
		return tracer.startActiveSpan("drizzle.operation", () => {
			return this._prepare().execute(placeholderValues);
		});
	}
};
applyMixins(PgAsyncRelationalQuery, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/raw.js
var PgRaw = class {
	static [entityKind] = "PgRaw";
	constructor(sql, query, mapBatchResult) {
		this.sql = sql;
		this.query = query;
		this.mapBatchResult = mapBatchResult;
	}
	/** @internal */
	getSQL() {
		return this.sql;
	}
	getQuery() {
		return this.query;
	}
	mapResult(result, isFromBatch) {
		return isFromBatch ? this.mapBatchResult(result) : result;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/raw.js
var PgAsyncRaw = class extends PgRaw {
	static [entityKind] = "PgAsyncRaw";
	constructor(execute, sql, query, mapBatchResult) {
		super(sql, query, mapBatchResult);
		this.execute = execute;
	}
	_prepare() {
		return this;
	}
};
applyMixins(PgAsyncRaw, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/refresh-materialized-view.js
var PgRefreshMaterializedView = class {
	static [entityKind] = "PgRefreshMaterializedView";
	config;
	constructor(view, session, dialect) {
		this.session = session;
		this.dialect = dialect;
		this.config = { view };
	}
	concurrently() {
		if (this.config.withNoData !== void 0) throw new Error("Cannot use concurrently and withNoData together");
		this.config.concurrently = true;
		return this;
	}
	withNoData() {
		if (this.config.concurrently !== void 0) throw new Error("Cannot use concurrently and withNoData together");
		this.config.withNoData = true;
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildRefreshMaterializedViewQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/refresh-materialized-view.js
var PgAsyncRefreshMaterializedView = class extends PgRefreshMaterializedView {
	static [entityKind] = "PgAsyncRefreshMaterializedView";
	/** @internal */
	_prepare(name, generateName = false) {
		return tracer.startActiveSpan("drizzle.prepareQuery", () => {
			const query = this.dialect.sqlToQuery(this.getSQL());
			return this.session.prepareQuery(query, "raw", name ?? generateName);
		});
	}
	prepare(name) {
		return this._prepare(name, true);
	}
	execute = (placeholderValues) => {
		return tracer.startActiveSpan("drizzle.operation", () => {
			return this._prepare().execute(placeholderValues);
		});
	};
};
applyMixins(PgAsyncRefreshMaterializedView, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/select.js
var PgAsyncSelectBase = class extends PgSelectBase {
	static [entityKind] = "PgAsyncSelectQueryBuilder";
	/** @internal */
	_prepare(name, generateName = false) {
		const { session, config, dialect, joinsNotNullableMap, cacheConfig, usedTables } = this;
		const { fields } = config;
		return tracer.startActiveSpan("drizzle.prepareQuery", () => {
			const query = this.config.tagged ? dialect._sqlToQuery(this.getSQL()) : dialect.sqlToQuery(this.getSQL());
			const fieldsList = orderSelectedFields(fields, void 0, this.dialect.codecs);
			const mapper = this.dialect.mapperGenerators.rows(fieldsList, joinsNotNullableMap);
			return session.prepareQuery(query, "arrays", name ?? generateName, mapper, {
				type: "select",
				tables: [...usedTables]
			}, cacheConfig);
		});
	}
	/**
	* Create a prepared statement for this query. This allows
	* the database to remember this query for the given session
	* and call it by name, rather than specifying the full query.
	*
	* {@link https://www.postgresql.org/docs/current/sql-prepare.html | Postgres prepare documentation}
	*/
	prepare(name) {
		return this._prepare(name, true);
	}
	execute(placeholderValues) {
		return tracer.startActiveSpan("drizzle.operation", () => {
			return this._prepare().execute(placeholderValues);
		});
	}
};
applyMixins(PgAsyncSelectBase, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/query-builders/update.js
var PgUpdateBuilder = class {
	static [entityKind] = "PgUpdateBuilder";
	constructor(table, session, dialect, withList, builder = PgUpdateBase) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.withList = withList;
		this.builder = builder;
	}
	/** @internal */
	authToken;
	/** @internal */
	setToken(token) {
		this.authToken = token;
		return this;
	}
	set(values) {
		const builder = new this.builder(this.table, mapUpdateSet(this.table, values), this.session, this.dialect, this.withList);
		if ("setToken" in builder) builder.setToken(this.authToken);
		return builder;
	}
};
var PgUpdateBase = class {
	static [entityKind] = "PgUpdate";
	config;
	tableName;
	joinsNotNullableMap;
	cacheConfig;
	constructor(table, set, session, dialect, withList) {
		this.session = session;
		this.dialect = dialect;
		this.config = {
			set,
			table,
			withList,
			joins: []
		};
		this.tableName = getTableLikeName(table);
		this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
	}
	from(source) {
		const src = source;
		const tableName = getTableLikeName(src);
		if (typeof tableName === "string") this.joinsNotNullableMap[tableName] = true;
		this.config.from = src;
		return this;
	}
	getTableLikeFields(table) {
		if (is(table, PgTable)) return table[Table.Symbol.Columns];
		else if (is(table, Subquery)) return table._.selectedFields;
		return table[ViewBaseConfig].selectedFields;
	}
	createJoin(joinType) {
		return ((table, on) => {
			const tableName = getTableLikeName(table);
			if (typeof tableName === "string" && this.config.joins.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
			if (typeof on === "function") {
				const from = this.config.from && !is(this.config.from, SQL$1) ? this.getTableLikeFields(this.config.from) : void 0;
				on = on(new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
					sqlAliasedBehavior: "sql",
					sqlBehavior: "sql"
				})), from && new Proxy(from, new SelectionProxyHandler({
					sqlAliasedBehavior: "sql",
					sqlBehavior: "sql"
				})));
			}
			this.config.joins.push({
				on,
				table,
				joinType,
				alias: tableName
			});
			if (typeof tableName === "string") switch (joinType) {
				case "left":
					this.joinsNotNullableMap[tableName] = false;
					break;
				case "right":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "inner":
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "full":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = false;
					break;
			}
			return this;
		});
	}
	leftJoin = this.createJoin("left");
	rightJoin = this.createJoin("right");
	innerJoin = this.createJoin("inner");
	fullJoin = this.createJoin("full");
	/**
	* Adds a 'where' clause to the query.
	*
	* Calling this method will update only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/update}
	*
	* @param where the 'where' clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be updated.
	*
	* ```ts
	* // Update all cars with green color
	* await db.update(cars).set({ color: 'red' })
	*   .where(eq(cars.color, 'green'));
	* // or
	* await db.update(cars).set({ color: 'red' })
	*   .where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Update all BMW cars with a green color
	* await db.update(cars).set({ color: 'red' })
	*   .where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Update all cars with the green or blue color
	* await db.update(cars).set({ color: 'red' })
	*   .where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		this.config.where = where;
		return this;
	}
	returning(fields) {
		if (!fields) {
			fields = Object.assign({}, this.config.table[Table.Symbol.Columns]);
			if (this.config.from) {
				const tableName = getTableLikeName(this.config.from);
				if (typeof tableName === "string" && this.config.from && !is(this.config.from, SQL$1)) {
					const fromFields = this.getTableLikeFields(this.config.from);
					fields[tableName] = fromFields;
				}
				for (const join of this.config.joins) {
					const tableName = getTableLikeName(join.table);
					if (typeof tableName === "string" && !is(join.table, SQL$1)) {
						const fromFields = this.getTableLikeFields(join.table);
						fields[tableName] = fromFields;
					}
				}
			}
		}
		this.config.returningFields = fields;
		this.config.returning = orderSelectedFields(fields, void 0, this.dialect.codecs);
		return this;
	}
	/**
	* Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
	*/
	comment(comment) {
		this.config.comment = sql$1.comment(comment);
		return this;
	}
	getSQL() {
		return this.dialect.buildUpdateQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	/** @internal */
	getSelectedFields() {
		return this.config.returningFields ? new Proxy(this.config.returningFields, new SelectionProxyHandler({
			alias: getTableName(this.config.table),
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		})) : void 0;
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		this.config.ignoreSelectionCastCodecs = true;
		return this;
	}
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/update.js
var PgAsyncUpdateBase = class extends PgUpdateBase {
	static [entityKind] = "PgAsyncUpdate";
	/** @internal */
	_prepare(name, generateName = false) {
		const { session, config, dialect, joinsNotNullableMap, cacheConfig } = this;
		const { returning: fields } = config;
		return tracer.startActiveSpan("drizzle.prepareQuery", () => {
			const query = dialect.sqlToQuery(this.getSQL());
			const mapper = fields ? this.dialect.mapperGenerators.rows(fields, joinsNotNullableMap) : void 0;
			return session.prepareQuery(query, fields ? "arrays" : "raw", name ?? generateName, mapper, {
				type: "update",
				tables: [...extractUsedTable$1(this.config.table)]
			}, cacheConfig);
		});
	}
	prepare(name) {
		return this._prepare(name, true);
	}
	execute = (placeholderValues = {}) => {
		return this._prepare().execute(placeholderValues);
	};
};
applyMixins(PgAsyncUpdateBase, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/db.js
var PgAsyncDatabase = class {
	static [entityKind] = "PgAsyncDatabase";
	query;
	constructor(dialect, session, relations, parseRqbJson = false, tagged = false) {
		this.dialect = dialect;
		this.session = session;
		this.tagged = tagged;
		this._ = {
			relations,
			session
		};
		this.query = {};
		for (const [tableName, relation] of Object.entries(relations)) this.query[tableName] = new RelationalQueryBuilder$1(relations, relations[relation.name].table, relation, dialect, session, parseRqbJson, PgAsyncRelationalQuery);
		this.$cache = { invalidate: async (_params) => {} };
	}
	/**
	* Creates a subquery that defines a temporary named result set as a CTE.
	*
	* It is useful for breaking down complex queries into simpler parts and for reusing the result set in subsequent parts of the query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
	*
	* @param alias The alias for the subquery.
	*
	* Failure to provide an alias will result in a DrizzleTypeError, preventing the subquery from being referenced in other queries.
	*
	* @example
	*
	* ```ts
	* // Create a subquery with alias 'sq' and use it in the select query
	* const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
	*
	* const result = await db.with(sq).select().from(sq);
	* ```
	*
	* To select arbitrary SQL values as fields in a CTE and reference them in other CTEs or in the main query, you need to add aliases to them:
	*
	* ```ts
	* // Select an arbitrary SQL value as a field in a CTE and reference it in the main query
	* const sq = db.$with('sq').as(db.select({
	*   name: sql<string>`upper(${users.name})`.as('name'),
	* })
	* .from(users));
	*
	* const result = await db.with(sq).select({ name: sq.name }).from(sq);
	* ```
	*/
	$with = (alias, selection) => {
		const as = (qb) => {
			if (typeof qb === "function") qb = qb(new QueryBuilder$1(this.dialect));
			const sql = ("withoutSelectionCastCodecs" in qb ? qb.withoutSelectionCastCodecs() : qb).getSQL();
			return new Proxy(new WithSubquery(sql, selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true, sql.usedTables ?? []), new SelectionProxyHandler({
				alias,
				sqlAliasedBehavior: "alias",
				sqlBehavior: "error"
			}));
		};
		return { as };
	};
	$count(source, filters) {
		return new PgAsyncCountBuilder({
			source,
			filters,
			session: this.session,
			dialect: this.dialect
		});
	}
	$cache;
	/**
	* Incorporates a previously defined CTE (using `$with`) into the main query.
	*
	* This method allows the main query to reference a temporary named result set.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
	*
	* @param queries The CTEs to incorporate into the main query.
	*
	* @example
	*
	* ```ts
	* // Define a subquery 'sq' as a CTE using $with
	* const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
	*
	* // Incorporate the CTE 'sq' into the main query and select from it
	* const result = await db.with(sq).select().from(sq);
	* ```
	*/
	with(...queries) {
		const self = this;
		function select(fields) {
			return new PgSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries,
				tagged: self.tagged
			}, PgAsyncSelectBase);
		}
		function selectDistinct(fields) {
			return new PgSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries,
				distinct: true,
				tagged: self.tagged
			}, PgAsyncSelectBase);
		}
		function selectDistinctOn(on, fields) {
			return new PgSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries,
				distinct: { on },
				tagged: self.tagged
			}, PgAsyncSelectBase);
		}
		/**
		* Creates an update query.
		*
		* Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
		*
		* Use `.set()` method to specify which values to update.
		*
		* See docs: {@link https://orm.drizzle.team/docs/update}
		*
		* @param table The table to update.
		*
		* @example
		*
		* ```ts
		* // Update all rows in the 'cars' table
		* await db.update(cars).set({ color: 'red' });
		*
		* // Update rows with filters and conditions
		* await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
		*
		* // Update with returning clause
		* const updatedCar: Car[] = await db.update(cars)
		*   .set({ color: 'red' })
		*   .where(eq(cars.id, 1))
		*   .returning();
		* ```
		*/
		function update(table) {
			return new PgUpdateBuilder(table, self.session, self.dialect, queries, PgAsyncUpdateBase);
		}
		/**
		* Creates an insert query.
		*
		* Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
		*
		* See docs: {@link https://orm.drizzle.team/docs/insert}
		*
		* @param table The table to insert into.
		*
		* @example
		*
		* ```ts
		* // Insert one row
		* await db.insert(cars).values({ brand: 'BMW' });
		*
		* // Insert multiple rows
		* await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
		*
		* // Insert with returning clause
		* const insertedCar: Car[] = await db.insert(cars)
		*   .values({ brand: 'BMW' })
		*   .returning();
		* ```
		*/
		function insert(table) {
			return new PgInsertBuilder(table, self.session, self.dialect, queries, void 0, PgAsyncInsertBase);
		}
		/**
		* Creates a delete query.
		*
		* Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
		*
		* See docs: {@link https://orm.drizzle.team/docs/delete}
		*
		* @param table The table to delete from.
		*
		* @example
		*
		* ```ts
		* // Delete all rows in the 'cars' table
		* await db.delete(cars);
		*
		* // Delete rows with filters and conditions
		* await db.delete(cars).where(eq(cars.color, 'green'));
		*
		* // Delete with returning clause
		* const deletedCar: Car[] = await db.delete(cars)
		*   .where(eq(cars.id, 1))
		*   .returning();
		* ```
		*/
		function delete_(table) {
			return new PgAsyncDeleteBase(table, self.session, self.dialect, queries);
		}
		return {
			select,
			selectDistinct,
			selectDistinctOn,
			update,
			insert,
			delete: delete_
		};
	}
	select(fields) {
		return new PgSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect,
			tagged: this.tagged
		}, PgAsyncSelectBase);
	}
	selectDistinct(fields) {
		return new PgSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect,
			distinct: true,
			tagged: this.tagged
		}, PgAsyncSelectBase);
	}
	selectDistinctOn(on, fields) {
		return new PgSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect,
			distinct: { on },
			tagged: this.tagged
		}, PgAsyncSelectBase);
	}
	/**
	* Creates an update query.
	*
	* Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
	*
	* Use `.set()` method to specify which values to update.
	*
	* See docs: {@link https://orm.drizzle.team/docs/update}
	*
	* @param table The table to update.
	*
	* @example
	*
	* ```ts
	* // Update all rows in the 'cars' table
	* await db.update(cars).set({ color: 'red' });
	*
	* // Update rows with filters and conditions
	* await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
	*
	* // Update with returning clause
	* const updatedCar: Car[] = await db.update(cars)
	*   .set({ color: 'red' })
	*   .where(eq(cars.id, 1))
	*   .returning();
	* ```
	*/
	update(table) {
		return new PgUpdateBuilder(table, this.session, this.dialect, void 0, PgAsyncUpdateBase);
	}
	/**
	* Creates an insert query.
	*
	* Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert}
	*
	* @param table The table to insert into.
	*
	* @example
	*
	* ```ts
	* // Insert one row
	* await db.insert(cars).values({ brand: 'BMW' });
	*
	* // Insert multiple rows
	* await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
	*
	* // Insert with returning clause
	* const insertedCar: Car[] = await db.insert(cars)
	*   .values({ brand: 'BMW' })
	*   .returning();
	* ```
	*/
	insert(table) {
		return new PgInsertBuilder(table, this.session, this.dialect, void 0, void 0, PgAsyncInsertBase);
	}
	/**
	* Creates a delete query.
	*
	* Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
	*
	* See docs: {@link https://orm.drizzle.team/docs/delete}
	*
	* @param table The table to delete from.
	*
	* @example
	*
	* ```ts
	* // Delete all rows in the 'cars' table
	* await db.delete(cars);
	*
	* // Delete rows with filters and conditions
	* await db.delete(cars).where(eq(cars.color, 'green'));
	*
	* // Delete with returning clause
	* const deletedCar: Car[] = await db.delete(cars)
	*   .where(eq(cars.id, 1))
	*   .returning();
	* ```
	*/
	delete(table) {
		return new PgAsyncDeleteBase(table, this.session, this.dialect);
	}
	refreshMaterializedView(view) {
		return new PgAsyncRefreshMaterializedView(view, this.session, this.dialect);
	}
	execute(query) {
		const sequel = typeof query === "string" ? sql$1.raw(query) : query.getSQL();
		const builtQuery = this.dialect.sqlToQuery(sequel);
		const prepared = this.session.prepareQuery(builtQuery, "raw", false);
		return new PgAsyncRaw(() => prepared.execute(), sequel, builtQuery, (result) => prepared.mapResult(result, true));
	}
	transaction(transaction, config) {
		return this.session.transaction(transaction, config);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/session.js
var PgBasePreparedQuery = class {
	static [entityKind] = "PgBasePreparedQuery";
	constructor(query) {
		this.query = query;
	}
	mapResult(_, __) {
		throw new Error("Method not implemented.");
	}
	getQuery() {
		return this.query;
	}
};
var PgSession = class {
	static [entityKind] = "PgSession";
	constructor(dialect) {
		this.dialect = dialect;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/async/session.js
var PgAsyncPreparedQuery = class extends PgBasePreparedQuery {
	static [entityKind] = "PgAsyncPreparedQuery";
	/** @internal */
	mapper;
	fastPath;
	constructor(executor, query, mapper, mode, logger, cache, queryMetadata, cacheConfig) {
		super(query);
		this.executor = executor;
		this.mode = mode;
		this.logger = logger;
		this.cache = cache;
		this.queryMetadata = queryMetadata;
		this.cacheConfig = cacheConfig;
		this.mapper = mapper;
		if (cache && cache.strategy() === "all" && cacheConfig === void 0) this.cacheConfig = {
			enabled: true,
			autoInvalidate: true
		};
		if (!this.cacheConfig?.enabled) this.cacheConfig = void 0;
		this.fastPath = cacheConfig === void 0 && (cache === void 0 || is(cache, NoopCache)) && true;
	}
	async execute(placeholderValues = {}) {
		const { query, logger, executor, mapper, fastPath } = this;
		if (fastPath) {
			const sql = query._sql ? query._sql.join(" ") : query.sql;
			const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
			logger.logQuery(sql, params);
			const res = executor(params).catch((e) => {
				throw new DrizzleQueryError(sql, params, e);
			});
			if (!mapper) return res;
			return res.then((rows) => mapper(rows));
		}
		return tracer.startActiveSpan("drizzle.execute", async (span) => {
			const params = fillPlaceholders(this.query.params, placeholderValues);
			const sql = this.query._sql ? this.query._sql.join(" ") : this.query.sql;
			const { mapper } = this;
			span?.setAttributes({
				"drizzle.query.text": sql,
				"drizzle.query.params": JSON.stringify(params)
			});
			this.logger.logQuery(sql, params);
			const query = tracer.startActiveSpan("drizzle.driver.execute", async (span) => {
				span?.setAttributes({
					"drizzle.query.text": sql,
					"drizzle.query.params": JSON.stringify(params)
				});
				return await this.queryWithCache(sql, params, () => this.executor(params));
			});
			if (!mapper) return query;
			return query.then((rows) => tracer.startActiveSpan("drizzle.mapResponse", () => mapper(rows)));
		});
	}
	/** @internal */
	async queryWithCache(queryString, params, query) {
		const cacheStrat = this.cache !== void 0 && !is(this.cache, NoopCache) ? await strategyFor(queryString, params, this.queryMetadata, this.cacheConfig) : { type: "skip" };
		if (cacheStrat.type === "skip") return query().catch((e) => {
			throw new DrizzleQueryError(queryString, params, e);
		});
		const cache = this.cache;
		if (cacheStrat.type === "invalidate") return Promise.all([query(), cache.onMutate({ tables: cacheStrat.tables })]).then((res) => res[0]).catch((e) => {
			throw new DrizzleQueryError(queryString, params, e);
		});
		if (cacheStrat.type === "try") {
			const { tables, key, isTag, autoInvalidate, config } = cacheStrat;
			const fromCache = await cache.get(key, tables, isTag, autoInvalidate);
			if (fromCache === void 0) {
				const result = await query().catch((e) => {
					throw new DrizzleQueryError(queryString, params, e);
				});
				await cache.put(key, result, autoInvalidate ? tables : [], isTag, config);
				return result;
			}
			return fromCache;
		}
		assertUnreachable(cacheStrat);
	}
};
var PgAsyncSession = class extends PgSession {
	static [entityKind] = "PgAsyncSession";
	execute(query) {
		return tracer.startActiveSpan("drizzle.operation", () => {
			return tracer.startActiveSpan("drizzle.prepareQuery", () => {
				return this.prepareQuery(this.dialect.sqlToQuery(query), "raw", false);
			}).execute();
		});
	}
	arrays(query) {
		return tracer.startActiveSpan("drizzle.operation", () => {
			return tracer.startActiveSpan("drizzle.prepareQuery", () => {
				return this.prepareQuery(this.dialect.sqlToQuery(query), "arrays", false);
			}).execute();
		});
	}
	objects(query) {
		return tracer.startActiveSpan("drizzle.operation", () => {
			return tracer.startActiveSpan("drizzle.prepareQuery", () => {
				return this.prepareQuery(this.dialect.sqlToQuery(query), "objects", false);
			}).execute();
		});
	}
};
var PgAsyncTransaction = class extends PgAsyncDatabase {
	static [entityKind] = "PgAsyncTransaction";
	constructor(dialect, session, relations, nestedIndex = 0, parseRqbJson) {
		super(dialect, session, relations, parseRqbJson);
		this.nestedIndex = nestedIndex;
	}
	rollback() {
		throw new TransactionRollbackError();
	}
	/** @internal */
	getTransactionConfigSQL(config) {
		const chunks = [];
		if (config.isolationLevel) chunks.push(`isolation level ${config.isolationLevel}`);
		if (config.accessMode) chunks.push(config.accessMode);
		if (typeof config.deferrable === "boolean") chunks.push(config.deferrable ? "deferrable" : "not deferrable");
		return sql$1.raw(chunks.join(" "));
	}
	setTransaction(config) {
		return this.session.execute(sql$1`set transaction ${this.getTransactionConfigSQL(config)}`);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/bun-sql/postgres/session.js
var BunSQLSession = class BunSQLSession extends PgAsyncSession {
	static [entityKind] = "BunSQLSession";
	logger;
	cache;
	constructor(client, dialect, relations, options = {}) {
		super(dialect);
		this.client = client;
		this.relations = relations;
		this.options = options;
		this.logger = options.logger ?? new NoopLogger();
		this.cache = options.cache ?? new NoopCache();
	}
	prepareQuery(query, mode, _name, mapper, queryMetadata, cacheConfig) {
		const tagged = query._sql ? query._sql : null;
		const client = this.client;
		return new PgAsyncPreparedQuery(tagged ? mode === "arrays" ? (params) => params ? client(tagged, ...params).values() : client(tagged).values() : (params) => params ? client(tagged, ...params) : client(tagged) : mode === "arrays" ? (params) => client.unsafe(query.sql, params).values() : (params) => client.unsafe(query.sql, params), query, mapper, mode, this.logger, this.cache, queryMetadata, cacheConfig);
	}
	transaction(transaction, config) {
		return this.client.begin(async (client) => {
			const session = new BunSQLSession(client, this.dialect, this.relations, this.options);
			const tx = new BunSQLTransaction(this.dialect, session, this.relations);
			if (config) await tx.setTransaction(config);
			return transaction(tx);
		});
	}
};
var BunSQLTransaction = class BunSQLTransaction extends PgAsyncTransaction {
	static [entityKind] = "BunSQLTransaction";
	constructor(dialect, session, relations, nestedIndex = 0) {
		super(dialect, session, relations, nestedIndex, false);
		this.session = session;
	}
	transaction(transaction) {
		return this.session.client.savepoint((client) => {
			const session = new BunSQLSession(client, this.dialect, this._.relations, this.session.options);
			return transaction(new BunSQLTransaction(this.dialect, session, this._.relations));
		});
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/bun-sql/postgres/driver.js
var BunSQLDatabase = class extends PgAsyncDatabase {
	static [entityKind] = "BunSQLDatabase";
};
function construct$1(client, config = {}) {
	client.options.bigint = true;
	const dialect = new PgDialect({
		useJitMappers: jitCompatCheck(config.jit),
		codecs: config.codecs ?? bunSqlPgCodecs
	});
	let logger;
	if (config.logger === true) logger = new DefaultLogger();
	else if (config.logger !== false) logger = config.logger;
	const relations = config.relations ?? {};
	const db = new BunSQLDatabase(dialect, new BunSQLSession(client, dialect, relations, {
		logger,
		cache: config.cache
	}), relations, false, true);
	db.$client = client;
	db.$cache = config.cache;
	if (db.$cache) db.$cache["invalidate"] = config.cache?.onMutate;
	return db;
}
function drizzle$2(...params) {
	if (typeof params[0] === "string") return construct$1(new SQL(params[0]), params[1]);
	const { connection, client, ...DrizzlePgConfig } = params[0];
	if (client) return construct$1(client, DrizzlePgConfig);
	if (typeof connection === "object" && connection.url !== void 0) {
		const { url, ...config } = connection;
		return construct$1(new SQL({
			url,
			...config
		}), DrizzlePgConfig);
	}
	return construct$1(new SQL(connection), DrizzlePgConfig);
}
(function(_drizzle) {
	function mock(config) {
		return construct$1({ options: {
			parsers: {},
			serializers: {}
		} }, config);
	}
	_drizzle.mock = mock;
})(drizzle$2 || (drizzle$2 = {}));
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/_relations.js
var Relation = class {
	static [entityKind] = "Relation";
	referencedTableName;
	fieldName;
	constructor(sourceTable, referencedTable, relationName) {
		this.sourceTable = sourceTable;
		this.referencedTable = referencedTable;
		this.relationName = relationName;
		this.referencedTableName = referencedTable[Table.Symbol.Name];
	}
};
var Relations = class {
	static [entityKind] = "Relations";
	constructor(table, config) {
		this.table = table;
		this.config = config;
	}
};
var One = class One extends Relation {
	static [entityKind] = "One";
	constructor(sourceTable, referencedTable, config, isNullable) {
		super(sourceTable, referencedTable, config?.relationName);
		this.config = config;
		this.isNullable = isNullable;
	}
	withFieldName(fieldName) {
		const relation = new One(this.sourceTable, this.referencedTable, this.config, this.isNullable);
		relation.fieldName = fieldName;
		return relation;
	}
};
var Many = class Many extends Relation {
	static [entityKind] = "Many";
	constructor(sourceTable, referencedTable, config) {
		super(sourceTable, referencedTable, config?.relationName);
		this.config = config;
	}
	withFieldName(fieldName) {
		const relation = new Many(this.sourceTable, this.referencedTable, this.config);
		relation.fieldName = fieldName;
		return relation;
	}
};
function getOperators() {
	return {
		and,
		between,
		eq,
		exists,
		gt,
		gte,
		ilike,
		inArray,
		isNull,
		isNotNull,
		like,
		lt,
		lte,
		ne,
		not,
		notBetween,
		notExists,
		notLike,
		notIlike,
		notInArray,
		or,
		sql: sql$1
	};
}
function getOrderByOperators() {
	return {
		sql: sql$1,
		asc,
		desc
	};
}
function extractTablesRelationalConfig(schema, configHelpers) {
	if (Object.keys(schema).length === 1 && "default" in schema && !is(schema["default"], Table)) schema = schema["default"];
	const tableNamesMap = {};
	const relationsBuffer = {};
	const tablesConfig = {};
	for (const [key, value] of Object.entries(schema)) if (is(value, Table)) {
		const dbName = getTableUniqueName(value);
		const bufferedRelations = relationsBuffer[dbName];
		tableNamesMap[dbName] = key;
		tablesConfig[key] = {
			tsName: key,
			dbName: value[Table.Symbol.Name],
			schema: value[Table.Symbol.Schema],
			columns: value[Table.Symbol.Columns],
			relations: bufferedRelations?.relations ?? {},
			primaryKey: bufferedRelations?.primaryKey ?? []
		};
		for (const column of Object.values(value[Table.Symbol.Columns])) if (column.primary) tablesConfig[key].primaryKey.push(column);
		const extraConfig = value[Table.Symbol.ExtraConfigBuilder]?.(value[Table.Symbol.ExtraConfigColumns]);
		if (extraConfig) {
			for (const configEntry of Object.values(extraConfig)) if (is(configEntry, PrimaryKeyBuilder)) tablesConfig[key].primaryKey.push(...configEntry.columns);
		}
	} else if (is(value, Relations)) {
		const dbName = getTableUniqueName(value.table);
		const tableName = tableNamesMap[dbName];
		const relations = value.config(configHelpers(value.table));
		for (const [relationName, relation] of Object.entries(relations)) if (tableName) {
			const tableConfig = tablesConfig[tableName];
			tableConfig.relations[relationName] = relation;
		} else {
			if (!(dbName in relationsBuffer)) relationsBuffer[dbName] = { relations: {} };
			relationsBuffer[dbName].relations[relationName] = relation;
		}
	}
	return {
		tables: tablesConfig,
		tableNamesMap
	};
}
function createOne(sourceTable) {
	return function one(table, config) {
		return new One(sourceTable, table, config, config?.fields.reduce((res, f) => res && f.notNull, true) ?? false);
	};
}
function createMany(sourceTable) {
	return function many(referencedTable, config) {
		return new Many(sourceTable, referencedTable, config);
	};
}
function normalizeRelation(schema, tableNamesMap, relation) {
	if (is(relation, One) && relation.config) return {
		fields: relation.config.fields,
		references: relation.config.references
	};
	const referencedTableTsName = tableNamesMap[getTableUniqueName(relation.referencedTable)];
	if (!referencedTableTsName) throw new Error(`Table "${relation.referencedTable[Table.Symbol.Name]}" not found in schema`);
	const referencedTableConfig = schema[referencedTableTsName];
	if (!referencedTableConfig) throw new Error(`Table "${referencedTableTsName}" not found in schema`);
	const sourceTable = relation.sourceTable;
	const sourceTableTsName = tableNamesMap[getTableUniqueName(sourceTable)];
	if (!sourceTableTsName) throw new Error(`Table "${sourceTable[Table.Symbol.Name]}" not found in schema`);
	const reverseRelations = [];
	for (const referencedTableRelation of Object.values(referencedTableConfig.relations)) if (relation.relationName && relation !== referencedTableRelation && referencedTableRelation.relationName === relation.relationName || !relation.relationName && referencedTableRelation.referencedTable === relation.sourceTable) reverseRelations.push(referencedTableRelation);
	if (reverseRelations.length > 1) throw relation.relationName ? /* @__PURE__ */ new Error(`There are multiple relations with name "${relation.relationName}" in table "${referencedTableTsName}"`) : /* @__PURE__ */ new Error(`There are multiple relations between "${referencedTableTsName}" and "${relation.sourceTable[Table.Symbol.Name]}". Please specify relation name`);
	if (reverseRelations[0] && is(reverseRelations[0], One) && reverseRelations[0].config) return {
		fields: reverseRelations[0].config.references,
		references: reverseRelations[0].config.fields
	};
	throw new Error(`There is not enough information to infer relation "${sourceTableTsName}.${relation.fieldName}"`);
}
function createTableRelationsHelpers(sourceTable) {
	return {
		one: createOne(sourceTable),
		many: createMany(sourceTable)
	};
}
function mapRelationalRow(tablesConfig, tableConfig, row, buildQueryResultSelection, mapColumnValue = (value) => value) {
	const result = {};
	for (const [selectionItemIndex, selectionItem] of buildQueryResultSelection.entries()) if (selectionItem.isJson) {
		const relation = tableConfig.relations[selectionItem.tsKey];
		const rawSubRows = row[selectionItemIndex];
		const subRows = typeof rawSubRows === "string" ? JSON.parse(rawSubRows) : rawSubRows;
		result[selectionItem.tsKey] = is(relation, One) ? subRows && mapRelationalRow(tablesConfig, tablesConfig[selectionItem.relationTableTsKey], subRows, selectionItem.selection, mapColumnValue) : subRows.map((subRow) => mapRelationalRow(tablesConfig, tablesConfig[selectionItem.relationTableTsKey], subRow, selectionItem.selection, mapColumnValue));
	} else {
		const value = mapColumnValue(row[selectionItemIndex]);
		const field = selectionItem.field;
		let decoder;
		if (is(field, Column)) decoder = field;
		else if (is(field, SQL$1)) decoder = field.decoder;
		else decoder = field.sql.decoder;
		result[selectionItem.tsKey] = value === null ? null : decoder.mapFromDriverValue(value);
	}
	return result;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/_query.js
var _RelationalQueryBuilder = class {
	static [entityKind] = "SQLiteAsyncRelationalQueryBuilder";
	constructor(mode, fullSchema, schema, tableNamesMap, table, tableConfig, dialect, session) {
		this.mode = mode;
		this.fullSchema = fullSchema;
		this.schema = schema;
		this.tableNamesMap = tableNamesMap;
		this.table = table;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
	}
	findMany(config) {
		return this.mode === "sync" ? new SQLiteSyncRelationalQuery$1(this.fullSchema, this.schema, this.tableNamesMap, this.table, this.tableConfig, this.dialect, this.session, config ? config : {}, "many") : new SQLiteRelationalQuery$1(this.fullSchema, this.schema, this.tableNamesMap, this.table, this.tableConfig, this.dialect, this.session, config ? config : {}, "many");
	}
	findFirst(config) {
		return this.mode === "sync" ? new SQLiteSyncRelationalQuery$1(this.fullSchema, this.schema, this.tableNamesMap, this.table, this.tableConfig, this.dialect, this.session, config ? {
			...config,
			limit: 1
		} : { limit: 1 }, "first") : new SQLiteRelationalQuery$1(this.fullSchema, this.schema, this.tableNamesMap, this.table, this.tableConfig, this.dialect, this.session, config ? {
			...config,
			limit: 1
		} : { limit: 1 }, "first");
	}
};
var SQLiteRelationalQuery$1 = class extends QueryPromise {
	static [entityKind] = "SQLiteAsyncRelationalQuery";
	/** @internal */
	mode;
	constructor(fullSchema, schema, tableNamesMap, table, tableConfig, dialect, session, config, mode) {
		super();
		this.fullSchema = fullSchema;
		this.schema = schema;
		this.tableNamesMap = tableNamesMap;
		this.table = table;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
		this.config = config;
		this.mode = mode;
	}
	/** @internal */
	getSQL() {
		return this.dialect._buildRelationalQuery({
			fullSchema: this.fullSchema,
			schema: this.schema,
			tableNamesMap: this.tableNamesMap,
			table: this.table,
			tableConfig: this.tableConfig,
			queryConfig: this.config,
			tableAlias: this.tableConfig.tsName
		}).sql;
	}
	/** @internal */
	_prepare(isOneTimeQuery = false) {
		const { query, builtQuery } = this._toSQL();
		return this.session[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](builtQuery, void 0, this.mode === "first" ? "get" : "all", (rawRows, mapColumnValue) => {
			const rows = rawRows.map((row) => mapRelationalRow(this.schema, this.tableConfig, row, query.selection, mapColumnValue));
			if (this.mode === "first") return rows[0];
			return rows;
		});
	}
	prepare() {
		return this._prepare(false);
	}
	_toSQL() {
		const query = this.dialect._buildRelationalQuery({
			fullSchema: this.fullSchema,
			schema: this.schema,
			tableNamesMap: this.tableNamesMap,
			table: this.table,
			tableConfig: this.tableConfig,
			queryConfig: this.config,
			tableAlias: this.tableConfig.tsName
		});
		return {
			query,
			builtQuery: this.dialect.sqlToQuery(query.sql)
		};
	}
	toSQL() {
		return this._toSQL().builtQuery;
	}
	/** @internal */
	executeRaw() {
		if (this.mode === "first") return this._prepare(false).get();
		return this._prepare(false).all();
	}
	async execute() {
		return this.executeRaw();
	}
};
var SQLiteSyncRelationalQuery$1 = class extends SQLiteRelationalQuery$1 {
	static [entityKind] = "SQLiteSyncRelationalQuery";
	sync() {
		return this.executeRaw();
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/count.js
var SQLiteCountBuilder = class SQLiteCountBuilder extends SQL$1 {
	static [entityKind] = "SQLiteCountBuilder";
	dialect;
	session;
	static buildCount(source, filters, parens) {
		const query = sql$1`select count(*) from ${source}${sql$1` where ${filters}`.if(filters)}`;
		return parens ? sql$1`(${query})` : query;
	}
	constructor(countConfig) {
		super(SQLiteCountBuilder.buildCount(countConfig.source, countConfig.filters, true).queryChunks);
		this.countConfig = countConfig;
		this.dialect = countConfig.dialect;
		this.session = countConfig.session;
		this.mapWith((e) => {
			if (typeof e === "number") return e;
			return Number(e ?? 0);
		});
	}
	executableSql;
	build() {
		if (!this.executableSql) {
			const { source, filters } = this.countConfig;
			this.executableSql = SQLiteCountBuilder.buildCount(source, filters);
		}
		return this.dialect.sqlToQuery(this.executableSql);
	}
	/** @internal */
	executeRaw(placeholderValues) {
		return this.session.prepareOneTimeQuery(this.build(), void 0, "get", (rows) => {
			const v = rows[0]?.[0];
			if (typeof v === "number") return v;
			return v ? Number(v) : 0;
		}).get(placeholderValues);
	}
	async execute(placeholderValues) {
		return await this.executeRaw(placeholderValues);
	}
};
var SQLiteSyncCountBuilder = class extends SQLiteCountBuilder {
	static [entityKind] = "SQLiteSyncCountBuilder";
	sync(placeholderValues) {
		return this.executeRaw(placeholderValues);
	}
};
applyMixins(SQLiteCountBuilder, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/query.js
var RelationalQueryBuilder = class {
	static [entityKind] = "SQLiteAsyncRelationalQueryBuilderV2";
	constructor(mode, schema, table, tableConfig, dialect, session, rowMode, forbidJsonb) {
		this.mode = mode;
		this.schema = schema;
		this.table = table;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
		this.rowMode = rowMode;
		this.forbidJsonb = forbidJsonb;
	}
	findMany(config) {
		return this.mode === "sync" ? new SQLiteSyncRelationalQuery(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "many", this.rowMode, this.forbidJsonb) : new SQLiteRelationalQuery(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "many", this.rowMode, this.forbidJsonb);
	}
	findFirst(config) {
		return this.mode === "sync" ? new SQLiteSyncRelationalQuery(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "first", this.rowMode, this.forbidJsonb) : new SQLiteRelationalQuery(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "first", this.rowMode, this.forbidJsonb);
	}
};
var SQLiteRelationalQuery = class extends QueryPromise {
	static [entityKind] = "SQLiteAsyncRelationalQueryV2";
	/** @internal */
	mode;
	/** @internal */
	table;
	constructor(schema, table, tableConfig, dialect, session, config, mode, rowMode, forbidJsonb) {
		super();
		this.schema = schema;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
		this.config = config;
		this.rowMode = rowMode;
		this.forbidJsonb = forbidJsonb;
		this.mode = mode;
		this.table = table;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildRelationalQuery({
			schema: this.schema,
			table: this.table,
			tableConfig: this.tableConfig,
			queryConfig: this.config,
			mode: this.mode,
			jsonb: this.forbidJsonb ? sql$1`json` : sql$1`jsonb`
		}).sql;
	}
	/** @internal */
	_prepare(isOneTimeQuery = true) {
		const { query, builtQuery } = this._toSQL();
		return this.session[isOneTimeQuery ? "prepareOneTimeRelationalQuery" : "prepareRelationalQuery"](builtQuery, void 0, this.mode === "first" ? "get" : "all", makeDefaultRqbMapper({
			isFirst: this.mode === "first",
			parseJson: !this.rowMode,
			parseJsonIfString: false,
			rootJsonMappers: true,
			selection: query.selection
		}), {
			isFirst: this.mode === "first",
			parseJson: !this.rowMode,
			parseJsonIfString: false,
			rootJsonMappers: true,
			selection: query.selection
		});
	}
	prepare() {
		return this._prepare(false);
	}
	_getQuery() {
		const jsonb = this.forbidJsonb ? sql$1`json` : sql$1`jsonb`;
		const query = this.dialect.buildRelationalQuery({
			schema: this.schema,
			table: this.table,
			tableConfig: this.tableConfig,
			queryConfig: this.config,
			mode: this.mode,
			isNested: this.rowMode,
			jsonb
		});
		if (this.rowMode) query.sql = sql$1`select json_object(${sql$1.join(query.selection.map((s) => {
			return sql$1`${sql$1.raw(this.dialect.escapeString(s.key))}, ${s.selection ? sql$1`${jsonb}(${sql$1.identifier(s.key)})` : sql$1.identifier(s.key)}`;
		}), sql$1`, `)}) as ${sql$1.identifier("r")} from (${query.sql}) as ${sql$1.identifier("t")}`;
		return query;
	}
	_toSQL() {
		const query = this._getQuery();
		return {
			query,
			builtQuery: this.dialect.sqlToQuery(query.sql)
		};
	}
	toSQL() {
		return this._toSQL().builtQuery;
	}
	/** @internal */
	executeRaw() {
		if (this.mode === "first") return this._prepare().get();
		return this._prepare().all();
	}
	async execute() {
		return this.executeRaw();
	}
};
var SQLiteSyncRelationalQuery = class extends SQLiteRelationalQuery {
	static [entityKind] = "SQLiteSyncRelationalQueryV2";
	sync() {
		return this.executeRaw();
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/raw.js
var SQLiteRaw = class extends QueryPromise {
	static [entityKind] = "SQLiteRaw";
	/** @internal */
	config;
	constructor(execute, getSQL, action, dialect, mapBatchResult) {
		super();
		this.execute = execute;
		this.getSQL = getSQL;
		this.dialect = dialect;
		this.mapBatchResult = mapBatchResult;
		this.config = { action };
	}
	getQuery() {
		return {
			...this.dialect.sqlToQuery(this.getSQL()),
			method: this.config.action
		};
	}
	mapResult(result, isFromBatch) {
		return isFromBatch ? this.mapBatchResult(result) : result;
	}
	_prepare() {
		return this;
	}
};
var SQLiteColumn = class extends Column {
	static [entityKind] = "SQLiteColumn";
	/** @internal */
	table;
	constructor(table, config) {
		super(table, config);
		this.table = table;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/table.js
/** @internal */
var InlineForeignKeys = Symbol.for("drizzle:SQLiteInlineForeignKeys");
var SQLiteTable = class extends Table {
	static [entityKind] = "SQLiteTable";
	/** @internal */
	static Symbol = Object.assign({}, Table.Symbol, { InlineForeignKeys });
	/** @internal */
	[Table.Symbol.Columns];
	/** @internal */
	[InlineForeignKeys] = [];
	/** @internal */
	[Table.Symbol.ExtraConfigBuilder] = void 0;
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/utils.js
function extractUsedTable(table) {
	if (is(table, SQLiteTable)) return [`${table[Table.Symbol.BaseName]}`];
	if (is(table, Subquery)) return table._.usedTables ?? [];
	if (is(table, SQL$1)) return table.usedTables ?? [];
	return [];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/view-base.js
var SQLiteViewBase = class extends View {
	static [entityKind] = "SQLiteViewBase";
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/select.js
var SQLiteSelectBuilder = class {
	static [entityKind] = "SQLiteSelectBuilder";
	fields;
	session;
	dialect;
	withList;
	distinct;
	constructor(config) {
		this.fields = config.fields;
		this.session = config.session;
		this.dialect = config.dialect;
		this.withList = config.withList;
		this.distinct = config.distinct;
	}
	from(source) {
		const isPartialSelect = !!this.fields;
		let fields;
		if (this.fields) fields = this.fields;
		else if (is(source, Subquery)) fields = Object.fromEntries(Object.keys(source._.selectedFields).map((key) => [key, source[key]]));
		else if (is(source, SQLiteViewBase)) fields = source[ViewBaseConfig].selectedFields;
		else if (is(source, SQL$1)) fields = {};
		else fields = getTableColumns(source);
		return new SQLiteSelectBase({
			table: source,
			fields,
			isPartialSelect,
			session: this.session,
			dialect: this.dialect,
			withList: this.withList,
			distinct: this.distinct
		});
	}
};
var SQLiteSelectQueryBuilderBase = class extends TypedQueryBuilder {
	static [entityKind] = "SQLiteSelectQueryBuilder";
	_;
	/** @internal */
	config;
	joinsNotNullableMap;
	tableName;
	isPartialSelect;
	session;
	dialect;
	cacheConfig = void 0;
	usedTables = /* @__PURE__ */ new Set();
	constructor({ table, fields, isPartialSelect, session, dialect, withList, distinct }) {
		super();
		this.config = {
			withList,
			table,
			fields: { ...fields },
			distinct,
			setOperators: []
		};
		this.isPartialSelect = isPartialSelect;
		this.session = session;
		this.dialect = dialect;
		this._ = {
			selectedFields: fields,
			config: this.config
		};
		this.tableName = getTableLikeName(table);
		this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
		for (const item of extractUsedTable(table)) this.usedTables.add(item);
	}
	/** @internal */
	getUsedTables() {
		return [...this.usedTables];
	}
	createJoin(joinType) {
		return (table, on) => {
			const baseTableName = this.tableName;
			const tableName = getTableLikeName(table);
			for (const item of extractUsedTable(table)) this.usedTables.add(item);
			if (typeof tableName === "string" && this.config.joins?.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
			if (!this.isPartialSelect) {
				if (Object.keys(this.joinsNotNullableMap).length === 1 && typeof baseTableName === "string") this.config.fields = { [baseTableName]: this.config.fields };
				if (typeof tableName === "string" && !is(table, SQL$1)) {
					const selection = is(table, Subquery) ? table._.selectedFields : is(table, View) ? table[ViewBaseConfig].selectedFields : table[Table.Symbol.Columns];
					this.config.fields[tableName] = selection;
				}
			}
			if (typeof on === "function") on = on(new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "sql",
				sqlBehavior: "sql"
			})));
			if (!this.config.joins) this.config.joins = [];
			this.config.joins.push({
				on,
				table,
				joinType,
				alias: tableName
			});
			if (typeof tableName === "string") switch (joinType) {
				case "left":
					this.joinsNotNullableMap[tableName] = false;
					break;
				case "right":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "cross":
				case "inner":
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "full":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = false;
					break;
			}
			return this;
		};
	}
	/**
	* Executes a `left join` operation by adding another table to the current query.
	*
	* Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#left-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User; pets: Pet | null; }[] = await db.select()
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	leftJoin = this.createJoin("left");
	/**
	* Executes a `right join` operation by adding another table to the current query.
	*
	* Calling this method associates each row of the joined table with the corresponding row from the main table, if a match is found. If no matching row exists, it sets all columns of the main table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#right-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User | null; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .rightJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number | null; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .rightJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	rightJoin = this.createJoin("right");
	/**
	* Executes an `inner join` operation, creating a new table by combining rows from two tables that have matching values.
	*
	* Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#inner-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .innerJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .innerJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	innerJoin = this.createJoin("inner");
	/**
	* Executes a `full join` operation by combining rows from two tables into a new table.
	*
	* Calling this method retrieves all rows from both main and joined tables, merging rows with matching values and filling in `null` for non-matching columns.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#full-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User | null; pets: Pet | null; }[] = await db.select()
	*   .from(users)
	*   .fullJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number | null; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .fullJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	fullJoin = this.createJoin("full");
	/**
	* Executes a `cross join` operation by combining rows from two tables into a new table.
	*
	* Calling this method retrieves all rows from both main and joined tables, merging all rows from each table.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#cross-join}
	*
	* @param table the table to join.
	*
	* @example
	*
	* ```ts
	* // Select all users, each user with every pet
	* const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .crossJoin(pets)
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .crossJoin(pets)
	* ```
	*/
	crossJoin = this.createJoin("cross");
	createSetOperator(type, isAll) {
		return (rightSelection) => {
			const rightSelect = typeof rightSelection === "function" ? rightSelection(getSQLiteSetOperators()) : rightSelection;
			if (!haveSameKeys(this.getSelectedFields(), rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
			this.config.setOperators.push({
				type,
				isAll,
				rightSelect
			});
			return this;
		};
	}
	/**
	* Adds `union` set operator to the query.
	*
	* Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
	*
	* @example
	*
	* ```ts
	* // Select all unique names from customers and users tables
	* await db.select({ name: users.name })
	*   .from(users)
	*   .union(
	*     db.select({ name: customers.name }).from(customers)
	*   );
	* // or
	* import { union } from 'drizzle-orm/sqlite-core'
	*
	* await union(
	*   db.select({ name: users.name }).from(users),
	*   db.select({ name: customers.name }).from(customers)
	* );
	* ```
	*/
	union = this.createSetOperator("union", false);
	/**
	* Adds `union all` set operator to the query.
	*
	* Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
	*
	* @example
	*
	* ```ts
	* // Select all transaction ids from both online and in-store sales
	* await db.select({ transaction: onlineSales.transactionId })
	*   .from(onlineSales)
	*   .unionAll(
	*     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
	*   );
	* // or
	* import { unionAll } from 'drizzle-orm/sqlite-core'
	*
	* await unionAll(
	*   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
	*   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
	* );
	* ```
	*/
	unionAll = this.createSetOperator("union", true);
	/**
	* Adds `intersect` set operator to the query.
	*
	* Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
	*
	* @example
	*
	* ```ts
	* // Select course names that are offered in both departments A and B
	* await db.select({ courseName: depA.courseName })
	*   .from(depA)
	*   .intersect(
	*     db.select({ courseName: depB.courseName }).from(depB)
	*   );
	* // or
	* import { intersect } from 'drizzle-orm/sqlite-core'
	*
	* await intersect(
	*   db.select({ courseName: depA.courseName }).from(depA),
	*   db.select({ courseName: depB.courseName }).from(depB)
	* );
	* ```
	*/
	intersect = this.createSetOperator("intersect", false);
	/**
	* Adds `except` set operator to the query.
	*
	* Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
	*
	* @example
	*
	* ```ts
	* // Select all courses offered in department A but not in department B
	* await db.select({ courseName: depA.courseName })
	*   .from(depA)
	*   .except(
	*     db.select({ courseName: depB.courseName }).from(depB)
	*   );
	* // or
	* import { except } from 'drizzle-orm/sqlite-core'
	*
	* await except(
	*   db.select({ courseName: depA.courseName }).from(depA),
	*   db.select({ courseName: depB.courseName }).from(depB)
	* );
	* ```
	*/
	except = this.createSetOperator("except", false);
	/** @internal */
	addSetOperators(setOperators) {
		this.config.setOperators.push(...setOperators);
		return this;
	}
	/**
	* Adds a `where` clause to the query.
	*
	* Calling this method will select only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#filtering}
	*
	* @param where the `where` clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be selected.
	*
	* ```ts
	* // Select all cars with green color
	* await db.select().from(cars).where(eq(cars.color, 'green'));
	* // or
	* await db.select().from(cars).where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Select all BMW cars with a green color
	* await db.select().from(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Select all cars with the green or blue color
	* await db.select().from(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		if (typeof where === "function") where = where(new Proxy(this.config.fields, new SelectionProxyHandler({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})));
		this.config.where = where;
		return this;
	}
	/**
	* Adds a `having` clause to the query.
	*
	* Calling this method will select only those rows that fulfill a specified condition. It is typically used with aggregate functions to filter the aggregated data based on a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#aggregations}
	*
	* @param having the `having` clause.
	*
	* @example
	*
	* ```ts
	* // Select all brands with more than one car
	* await db.select({
	* 	brand: cars.brand,
	* 	count: sql<number>`cast(count(${cars.id}) as int)`,
	* })
	*   .from(cars)
	*   .groupBy(cars.brand)
	*   .having(({ count }) => gt(count, 1));
	* ```
	*/
	having(having) {
		if (typeof having === "function") having = having(new Proxy(this.config.fields, new SelectionProxyHandler({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})));
		this.config.having = having;
		return this;
	}
	groupBy(...columns) {
		if (typeof columns[0] === "function") {
			const groupBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			this.config.groupBy = Array.isArray(groupBy) ? groupBy : [groupBy];
		} else this.config.groupBy = columns;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
			else this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
			else this.config.orderBy = orderByArray;
		}
		return this;
	}
	/**
	* Adds a `limit` clause to the query.
	*
	* Calling this method will set the maximum number of rows that will be returned by this query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
	*
	* @param limit the `limit` clause.
	*
	* @example
	*
	* ```ts
	* // Get the first 10 people from this query.
	* await db.select().from(people).limit(10);
	* ```
	*/
	limit(limit) {
		if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).limit = limit;
		else this.config.limit = limit;
		return this;
	}
	/**
	* Adds an `offset` clause to the query.
	*
	* Calling this method will skip a number of rows when returning results from this query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
	*
	* @param offset the `offset` clause.
	*
	* @example
	*
	* ```ts
	* // Get the 10th-20th people from this query.
	* await db.select().from(people).offset(10).limit(10);
	* ```
	*/
	offset(offset) {
		if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).offset = offset;
		else this.config.offset = offset;
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildSelectQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	as(alias) {
		const usedTables = [];
		usedTables.push(...extractUsedTable(this.config.table));
		if (this.config.joins) for (const it of this.config.joins) usedTables.push(...extractUsedTable(it.table));
		return new Proxy(new Subquery(this.getSQL(), this.config.fields, alias, false, [...new Set(usedTables)]), new SelectionProxyHandler({
			alias,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	/** @internal */
	getSelectedFields() {
		return new Proxy(this.config.fields, new SelectionProxyHandler({
			alias: this.tableName,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		return this;
	}
	$dynamic() {
		return this;
	}
};
var SQLiteSelectBase = class extends SQLiteSelectQueryBuilderBase {
	static [entityKind] = "SQLiteSelect";
	/** @internal */
	_prepare(isOneTimeQuery = true) {
		if (!this.session) throw new Error("Cannot execute a query on a query builder. Please use a database instance instead.");
		const fieldsList = orderSelectedFields(this.config.fields);
		const query = this.session[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](this.dialect.sqlToQuery(this.getSQL()), fieldsList, "all", void 0, {
			type: "select",
			tables: [...this.usedTables]
		}, this.cacheConfig);
		query.joinsNotNullableMap = this.joinsNotNullableMap;
		return query;
	}
	$withCache(config) {
		this.cacheConfig = config === void 0 ? {
			config: {},
			enabled: true,
			autoInvalidate: true
		} : config === false ? { enabled: false } : {
			enabled: true,
			autoInvalidate: true,
			...config
		};
		return this;
	}
	prepare() {
		return this._prepare(false);
	}
	run = (placeholderValues) => {
		return this._prepare().run(placeholderValues);
	};
	all = (placeholderValues) => {
		return this._prepare().all(placeholderValues);
	};
	get = (placeholderValues) => {
		return this._prepare().get(placeholderValues);
	};
	values = (placeholderValues) => {
		return this._prepare().values(placeholderValues);
	};
	async execute() {
		return this.all();
	}
};
applyMixins(SQLiteSelectBase, [QueryPromise]);
function createSetOperator(type, isAll) {
	return (leftSelect, rightSelect, ...restSelects) => {
		const setOperators = [rightSelect, ...restSelects].map((select) => ({
			type,
			isAll,
			rightSelect: select
		}));
		for (const setOperator of setOperators) if (!haveSameKeys(leftSelect.getSelectedFields(), setOperator.rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
		return leftSelect.addSetOperators(setOperators);
	};
}
var getSQLiteSetOperators = () => ({
	union,
	unionAll,
	intersect,
	except
});
/**
* Adds `union` set operator to the query.
*
* Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
*
* @example
*
* ```ts
* // Select all unique names from customers and users tables
* import { union } from 'drizzle-orm/sqlite-core'
*
* await union(
*   db.select({ name: users.name }).from(users),
*   db.select({ name: customers.name }).from(customers)
* );
* // or
* await db.select({ name: users.name })
*   .from(users)
*   .union(
*     db.select({ name: customers.name }).from(customers)
*   );
* ```
*/
var union = createSetOperator("union", false);
/**
* Adds `union all` set operator to the query.
*
* Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
*
* @example
*
* ```ts
* // Select all transaction ids from both online and in-store sales
* import { unionAll } from 'drizzle-orm/sqlite-core'
*
* await unionAll(
*   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
*   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
* );
* // or
* await db.select({ transaction: onlineSales.transactionId })
*   .from(onlineSales)
*   .unionAll(
*     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
*   );
* ```
*/
var unionAll = createSetOperator("union", true);
/**
* Adds `intersect` set operator to the query.
*
* Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
*
* @example
*
* ```ts
* // Select course names that are offered in both departments A and B
* import { intersect } from 'drizzle-orm/sqlite-core'
*
* await intersect(
*   db.select({ courseName: depA.courseName }).from(depA),
*   db.select({ courseName: depB.courseName }).from(depB)
* );
* // or
* await db.select({ courseName: depA.courseName })
*   .from(depA)
*   .intersect(
*     db.select({ courseName: depB.courseName }).from(depB)
*   );
* ```
*/
var intersect = createSetOperator("intersect", false);
/**
* Adds `except` set operator to the query.
*
* Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
*
* @example
*
* ```ts
* // Select all courses offered in department A but not in department B
* import { except } from 'drizzle-orm/sqlite-core'
*
* await except(
*   db.select({ courseName: depA.courseName }).from(depA),
*   db.select({ courseName: depB.courseName }).from(depB)
* );
* // or
* await db.select({ courseName: depA.courseName })
*   .from(depA)
*   .except(
*     db.select({ courseName: depB.courseName }).from(depB)
*   );
* ```
*/
var except = createSetOperator("except", false);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/up-migrations/sqlite.js
/**
* Detects the current version of the migrations table schema and upgrades it if needed.
*
* Version 0: Original schema (id, hash, created_at)
* Version 1: Extended schema (id, hash, created_at, name, applied_at)
*/
function upgradeSyncIfNeeded(migrationsTable, session, localMigrations) {
	if (session.all(sql$1`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${migrationsTable}`).length === 0) return { newDb: true };
	const rows = session.all(sql$1`SELECT name as column_name FROM pragma_table_info(${migrationsTable})`);
	const version = GET_VERSION_FOR.sqlite(rows.map((r) => r.column_name));
	for (let v = version; v < MIGRATIONS_TABLE_VERSIONS.sqlite; v++) {
		const upgradeFn = upgradeSyncFunctions[v];
		if (!upgradeFn) throw new Error(`No upgrade path from migration table version ${v} to ${v + 1}`);
		upgradeFn(migrationsTable, session, localMigrations);
	}
	return { newDb: false };
}
var upgradeSyncFunctions = { 0: (migrationsTable, session, localMigrations) => {
	const table = sql$1`${sql$1.identifier(migrationsTable)}`;
	const dbRows = session.all(sql$1`SELECT id, hash, created_at FROM ${table} ORDER BY id ASC`);
	localMigrations.sort((a, b) => a.folderMillis !== b.folderMillis ? a.folderMillis - b.folderMillis : (a.name ?? "").localeCompare(b.name ?? ""));
	const byMillis = /* @__PURE__ */ new Map();
	const byHash = /* @__PURE__ */ new Map();
	for (const lm of localMigrations) {
		if (!byMillis.has(lm.folderMillis)) byMillis.set(lm.folderMillis, []);
		byMillis.get(lm.folderMillis).push(lm);
		byHash.set(lm.hash, lm);
	}
	const toApply = [];
	let unmatched = [];
	for (const dbRow of dbRows) {
		const stringified = String(dbRow.created_at);
		const millis = Number(stringified.substring(0, stringified.length - 3) + "000");
		const candidates = byMillis.get(millis);
		let matched;
		let matchedBy = null;
		if (candidates && candidates.length === 1) {
			matched = candidates[0];
			matchedBy = "millis";
		} else if (candidates && candidates.length > 1) {
			matched = candidates.find((c) => c.hash && dbRow.hash && c.hash === dbRow.hash);
			if (matched) matchedBy = "hash";
		} else {
			matched = byHash.get(dbRow.hash);
			if (matched) matchedBy = "hash";
		}
		if (matched) toApply.push({
			id: dbRow.id,
			name: matched.name,
			hash: dbRow.hash,
			created_at: stringified,
			matchedBy: dbRow.id ? "id" : matchedBy
		});
		else unmatched.push(dbRow);
	}
	if (unmatched.length > 0) throw Error(`While upgrading your database migrations table we found ${unmatched.length} (${unmatched.map((it) => `[id: ${it.id}, created_at: ${it.created_at}]`).join(", ")}) migrations in the database that do not match any local migration. This means that some migrations were applied to the database but are missing from the local environment`);
	session.transaction((tx) => {
		tx.run(sql$1`ALTER TABLE ${table} ADD COLUMN ${sql$1.identifier("name")} text`);
		tx.run(sql$1`ALTER TABLE ${table} ADD COLUMN ${sql$1.identifier("applied_at")} TEXT`);
		for (const backfillEntry of toApply) {
			const updateQuery = sql$1`UPDATE ${table} SET ${sql$1.identifier("name")} = ${backfillEntry.name}, ${sql$1.identifier("applied_at")} = NULL WHERE`;
			if (backfillEntry.id) updateQuery.append(sql$1` ${sql$1.identifier("id")} = ${backfillEntry.id}`);
			else if (backfillEntry.matchedBy === "millis") updateQuery.append(sql$1` ${sql$1.identifier("created_at")} = ${backfillEntry.created_at}`);
			else updateQuery.append(sql$1` ${sql$1.identifier("hash")} = ${backfillEntry.hash}`);
			tx.run(updateQuery);
		}
	});
} };
/**
* Detects the current version of the migrations table schema and upgrades it if needed.
*
* Version 0: Original schema (id, hash, created_at)
* Version 1: Extended schema (id, hash, created_at, name, applied_at)
*/
async function upgradeAsyncIfNeeded(migrationsTable, db, localMigrations) {
	if ((await db.session.all(sql$1`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${migrationsTable}`)).length === 0) return { newDb: true };
	const rows = await db.session.all(sql$1`SELECT name as column_name FROM pragma_table_info(${migrationsTable})`);
	const version = GET_VERSION_FOR.sqlite(rows.map((r) => r.column_name));
	for (let v = version; v < MIGRATIONS_TABLE_VERSIONS.sqlite; v++) {
		const upgradeFn = upgradeAsyncFunctions[v];
		if (!upgradeFn) throw new Error(`No upgrade path from migration table version ${v} to ${v + 1}`);
		await upgradeFn(migrationsTable, db, localMigrations);
	}
	return { newDb: false };
}
var upgradeAsyncFunctions = { 0: async (migrationsTable, db, localMigrations) => {
	const table = sql$1`${sql$1.identifier(migrationsTable)}`;
	const dbRows = await db.session.all(sql$1`SELECT id, hash, created_at FROM ${table} ORDER BY id ASC`);
	localMigrations.sort((a, b) => a.folderMillis !== b.folderMillis ? a.folderMillis - b.folderMillis : (a.name ?? "").localeCompare(b.name ?? ""));
	const byMillis = /* @__PURE__ */ new Map();
	const byHash = /* @__PURE__ */ new Map();
	for (const lm of localMigrations) {
		if (!byMillis.has(lm.folderMillis)) byMillis.set(lm.folderMillis, []);
		byMillis.get(lm.folderMillis).push(lm);
		byHash.set(lm.hash, lm);
	}
	const toApply = [];
	let unmatched = [];
	for (const dbRow of dbRows) {
		const stringified = String(dbRow.created_at);
		const millis = Number(stringified.substring(0, stringified.length - 3) + "000");
		const candidates = byMillis.get(millis);
		let matched;
		let matchedBy = null;
		if (candidates && candidates.length === 1) {
			matched = candidates[0];
			matchedBy = "millis";
		} else if (candidates && candidates.length > 1) {
			matched = candidates.find((c) => c.hash && dbRow.hash && c.hash === dbRow.hash);
			if (matched) matchedBy = "hash";
		} else {
			matched = byHash.get(dbRow.hash);
			if (matched) matchedBy = "hash";
		}
		if (matched) toApply.push({
			id: dbRow.id,
			name: matched.name,
			hash: dbRow.hash,
			created_at: stringified,
			matchedBy: dbRow.id ? "id" : matchedBy
		});
		else unmatched.push(dbRow);
	}
	if (unmatched.length > 0) throw Error(`While upgrading your database migrations table we found ${unmatched.length} (${unmatched.map((it) => `[id: ${it.id}, created_at: ${it.created_at}]`).join(", ")}) migrations in the database that do not match any local migration. This means that some migrations were applied to the database but are missing from the local environment`);
	const statements = [sql$1`ALTER TABLE ${table} ADD COLUMN ${sql$1.identifier("name")} text`, sql$1`ALTER TABLE ${table} ADD COLUMN ${sql$1.identifier("applied_at")} TEXT`];
	for (const backfillEntry of toApply) {
		const updateQuery = sql$1`UPDATE ${table} SET ${sql$1.identifier("name")} = ${backfillEntry.name}, ${sql$1.identifier("applied_at")} = NULL WHERE`;
		if (backfillEntry.id) updateQuery.append(sql$1` ${sql$1.identifier("id")} = ${backfillEntry.id}`);
		else if (backfillEntry.matchedBy === "millis") updateQuery.append(sql$1` ${sql$1.identifier("created_at")} = ${backfillEntry.created_at}`);
		else updateQuery.append(sql$1` ${sql$1.identifier("hash")} = ${backfillEntry.hash}`);
		statements.push(updateQuery);
	}
	await db.transaction(async (tx) => {
		for (const statement of statements) await tx.run(statement);
	});
} };
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/dialect.js
var SQLiteDialect = class {
	static [entityKind] = "SQLiteDialect";
	constructor(_config) {}
	escapeName(name) {
		return `"${name.replace(/"/g, "\"\"")}"`;
	}
	escapeParam(_num) {
		return "?";
	}
	escapeString(str) {
		return `'${str.replace(/'/g, "''")}'`;
	}
	buildWithCTE(queries) {
		if (!queries?.length) return void 0;
		const withSqlChunks = [sql$1`with `];
		for (const [i, w] of queries.entries()) {
			withSqlChunks.push(sql$1`${sql$1.identifier(w._.alias)} as (${w._.sql})`);
			if (i < queries.length - 1) withSqlChunks.push(sql$1`, `);
		}
		withSqlChunks.push(sql$1` `);
		return sql$1.join(withSqlChunks);
	}
	buildDeleteQuery({ table, where, returning, withList, limit, orderBy }) {
		const withSql = this.buildWithCTE(withList);
		const returningSql = returning ? sql$1` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
		return sql$1`${withSql}delete from ${table}${where ? sql$1` where ${where}` : void 0}${returningSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}`;
	}
	buildUpdateSet(table, set) {
		const tableColumns = table[Table.Symbol.Columns];
		const columnNames = Object.keys(tableColumns).filter((colName) => set[colName] !== void 0 || tableColumns[colName]?.onUpdateFn !== void 0);
		const setLength = columnNames.length;
		return sql$1.join(columnNames.flatMap((colName, i) => {
			const col = tableColumns[colName];
			const onUpdateFnResult = col.onUpdateFn?.();
			const value = set[colName] ?? (is(onUpdateFnResult, SQL$1) ? onUpdateFnResult : sql$1.param(onUpdateFnResult, col));
			const res = sql$1`${sql$1.identifier(col.name)} = ${value}`;
			if (i < setLength - 1) return [res, sql$1.raw(", ")];
			return [res];
		}));
	}
	buildUpdateQuery({ table, set, where, returning, withList, joins, from, limit, orderBy }) {
		const withSql = this.buildWithCTE(withList);
		const setSql = this.buildUpdateSet(table, set);
		const fromSql = from && sql$1.join([sql$1.raw(" from "), this.buildFromTable(from)]);
		const joinsSql = this.buildJoins(joins);
		const returningSql = returning ? sql$1` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
		return sql$1`${withSql}update ${table} set ${setSql}${fromSql}${joinsSql}${where ? sql$1` where ${where}` : void 0}${returningSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}`;
	}
	/**
	* Builds selection SQL with provided fields/expressions
	*
	* Examples:
	*
	* `select <selection> from`
	*
	* `insert ... returning <selection>`
	*
	* If `isSingleTable` is true, then columns won't be prefixed with table name
	*/
	buildSelection(fields, { isSingleTable = false } = {}) {
		const columnsLen = fields.length;
		const chunks = fields.flatMap(({ field }, i) => {
			const chunk = [];
			if (is(field, SQL$1.Aliased) && field.isSelectionField) {
				if (!isSingleTable && field.origin !== void 0) chunk.push(sql$1.identifier(field.origin), sql$1.raw("."));
				chunk.push(sql$1.identifier(field.fieldAlias));
			} else if (is(field, SQL$1.Aliased) || is(field, SQL$1)) {
				const query = is(field, SQL$1.Aliased) ? field.sql : field;
				if (isSingleTable) {
					const newSql = new SQL$1(query.queryChunks.map((c) => {
						if (is(c, Column)) return sql$1.identifier(c.name);
						return c;
					}));
					chunk.push(query.shouldInlineParams ? newSql.inlineParams() : newSql);
				} else chunk.push(query);
				if (is(field, SQL$1.Aliased)) chunk.push(sql$1` as ${sql$1.identifier(field.fieldAlias)}`);
			} else if (is(field, Column)) if (field.columnType === "SQLiteNumericBigInt") if (isSingleTable) chunk.push(field.isAlias ? sql$1`cast(${sql$1.identifier(getOriginalColumnFromAlias(field).name)} as text) as ${field}` : sql$1`cast(${sql$1.identifier(field.name)} as text)`);
			else chunk.push(field.isAlias ? sql$1`cast(${getOriginalColumnFromAlias(field)} as text) as ${field}` : sql$1`cast(${field} as text)`);
			else if (isSingleTable) chunk.push(field.isAlias ? sql$1`${sql$1.identifier(getOriginalColumnFromAlias(field).name)} as ${field}` : sql$1.identifier(field.name));
			else chunk.push(field.isAlias ? sql$1`${getOriginalColumnFromAlias(field)} as ${field}` : field);
			else if (is(field, Subquery)) {
				const entries = Object.entries(field._.selectedFields);
				if (entries.length === 1) {
					const entry = entries[0][1];
					const fieldDecoder = is(entry, SQL$1) ? entry.decoder : is(entry, Column) ? { mapFromDriverValue: (v) => entry.mapFromDriverValue(v) } : entry.sql.decoder;
					if (fieldDecoder) field._.sql.decoder = fieldDecoder;
				}
				chunk.push(field);
			}
			if (i < columnsLen - 1) chunk.push(sql$1`, `);
			return chunk;
		});
		return sql$1.join(chunks);
	}
	buildJoins(joins) {
		if (!joins || joins.length === 0) return;
		const joinsArray = [];
		if (joins) for (const [index, joinMeta] of joins.entries()) {
			if (index === 0) joinsArray.push(sql$1` `);
			const table = joinMeta.table;
			const onSql = joinMeta.on ? sql$1` on ${joinMeta.on}` : void 0;
			if (is(table, SQLiteTable)) {
				const tableName = table[SQLiteTable.Symbol.Name];
				const tableSchema = table[SQLiteTable.Symbol.Schema];
				const origTableName = table[SQLiteTable.Symbol.OriginalName];
				const alias = tableName === origTableName ? void 0 : joinMeta.alias;
				joinsArray.push(sql$1`${sql$1.raw(joinMeta.joinType)} join ${tableSchema ? sql$1`${sql$1.identifier(tableSchema)}.` : void 0}${sql$1.identifier(origTableName)}${alias && sql$1` ${sql$1.identifier(alias)}`}${onSql}`);
			} else joinsArray.push(sql$1`${sql$1.raw(joinMeta.joinType)} join ${table}${onSql}`);
			if (index < joins.length - 1) joinsArray.push(sql$1` `);
		}
		return sql$1.join(joinsArray);
	}
	buildLimit(limit) {
		return typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql$1` limit ${limit}` : void 0;
	}
	buildOrderBy(orderBy) {
		const orderByList = [];
		if (orderBy) for (const [index, orderByValue] of orderBy.entries()) {
			orderByList.push(orderByValue);
			if (index < orderBy.length - 1) orderByList.push(sql$1`, `);
		}
		return orderByList.length > 0 ? sql$1` order by ${sql$1.join(orderByList)}` : void 0;
	}
	buildFromTable(table) {
		if (is(table, Table) && table[Table.Symbol.IsAlias]) return sql$1`${sql$1`${sql$1.identifier(table[Table.Symbol.Schema] ?? "")}.`.if(table[Table.Symbol.Schema])}${sql$1.identifier(table[Table.Symbol.OriginalName])} ${sql$1.identifier(table[Table.Symbol.Name])}`;
		if (is(table, View) && table[ViewBaseConfig].isAlias) {
			let fullName = sql$1`${sql$1.identifier(table[ViewBaseConfig].originalName)}`;
			if (table[ViewBaseConfig].schema) fullName = sql$1`${sql$1.identifier(table[ViewBaseConfig].schema)}.${fullName}`;
			return sql$1`${fullName} ${sql$1.identifier(table[ViewBaseConfig].name)}`;
		}
		return table;
	}
	buildSelectQuery({ withList, fields, fieldsFlat, where, having, table, joins, orderBy, groupBy, limit, offset, distinct, setOperators }) {
		const fieldsList = fieldsFlat ?? orderSelectedFields(fields);
		for (const f of fieldsList) if (is(f.field, Column) && getTableName(f.field.table) !== (is(table, Subquery) ? table._.alias : is(table, SQLiteViewBase) ? table[ViewBaseConfig].name : is(table, SQL$1) ? void 0 : getTableName(table)) && !((table) => joins?.some(({ alias }) => alias === (table[Table.Symbol.IsAlias] ? getTableName(table) : table[Table.Symbol.BaseName])))(f.field.table)) {
			const tableName = getTableName(f.field.table);
			throw new Error(`Your "${f.path.join("->")}" field references a column "${tableName}"."${f.field.name}", but the table "${tableName}" is not part of the query! Did you forget to join it?`);
		}
		const isSingleTable = !joins || joins.length === 0;
		const withSql = this.buildWithCTE(withList);
		const distinctSql = distinct ? sql$1` distinct` : void 0;
		const selection = this.buildSelection(fieldsList, { isSingleTable });
		const tableSql = this.buildFromTable(table);
		const joinsSql = this.buildJoins(joins);
		const whereSql = where ? sql$1` where ${where}` : void 0;
		const havingSql = having ? sql$1` having ${having}` : void 0;
		const groupByList = [];
		if (groupBy) for (const [index, groupByValue] of groupBy.entries()) {
			groupByList.push(groupByValue);
			if (index < groupBy.length - 1) groupByList.push(sql$1`, `);
		}
		const finalQuery = sql$1`${withSql}select${distinctSql} ${selection} from ${tableSql}${joinsSql}${whereSql}${groupByList.length > 0 ? sql$1` group by ${sql$1.join(groupByList)}` : void 0}${havingSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}${offset ? sql$1` offset ${offset}` : void 0}`;
		if (setOperators.length > 0) return this.buildSetOperations(finalQuery, setOperators);
		return finalQuery;
	}
	buildSetOperations(leftSelect, setOperators) {
		const [setOperator, ...rest] = setOperators;
		if (!setOperator) throw new Error("Cannot pass undefined values to any set operator");
		if (rest.length === 0) return this.buildSetOperationQuery({
			leftSelect,
			setOperator
		});
		return this.buildSetOperations(this.buildSetOperationQuery({
			leftSelect,
			setOperator
		}), rest);
	}
	buildSetOperationQuery({ leftSelect, setOperator: { type, isAll, rightSelect, limit, orderBy, offset } }) {
		const leftChunk = sql$1`${leftSelect.getSQL()} `;
		const rightChunk = sql$1`${rightSelect.getSQL()}`;
		let orderBySql;
		if (orderBy && orderBy.length > 0) {
			const orderByValues = [];
			for (const singleOrderBy of orderBy) if (is(singleOrderBy, SQLiteColumn)) orderByValues.push(sql$1.identifier(singleOrderBy.name));
			else if (is(singleOrderBy, SQL$1)) {
				for (let i = 0; i < singleOrderBy.queryChunks.length; i++) {
					const chunk = singleOrderBy.queryChunks[i];
					if (is(chunk, SQLiteColumn)) singleOrderBy.queryChunks[i] = sql$1.identifier(chunk.name);
				}
				orderByValues.push(sql$1`${singleOrderBy}`);
			} else orderByValues.push(sql$1`${singleOrderBy}`);
			orderBySql = sql$1` order by ${sql$1.join(orderByValues, sql$1`, `)}`;
		}
		const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql$1` limit ${limit}` : void 0;
		const operatorChunk = sql$1.raw(`${type} ${isAll ? "all " : ""}`);
		const offsetSql = offset ? sql$1` offset ${offset}` : void 0;
		return sql$1`${leftChunk}${operatorChunk}${rightChunk}${orderBySql}${limitSql}${offsetSql}`;
	}
	buildInsertQuery({ table, values: valuesOrSelect, onConflict, returning, withList, select }) {
		const valuesSqlList = [];
		const columns = table[Table.Symbol.Columns];
		const colEntries = Object.entries(columns).filter(([_, col]) => !col.shouldDisableInsert());
		const insertOrder = colEntries.map(([, column]) => sql$1.identifier(column.name));
		if (select) {
			const select = valuesOrSelect;
			if (is(select, SQL$1)) valuesSqlList.push(select);
			else valuesSqlList.push(select.getSQL());
		} else {
			const values = valuesOrSelect;
			valuesSqlList.push(sql$1.raw("values "));
			for (const [valueIndex, value] of values.entries()) {
				const valueList = [];
				for (const [fieldName, col] of colEntries) {
					const colValue = value[fieldName];
					if (colValue === void 0 || is(colValue, Param) && colValue.value === void 0) {
						let defaultValue;
						if (col.default !== null && col.default !== void 0) defaultValue = is(col.default, SQL$1) ? col.default : sql$1.param(col.default, col);
						else if (col.defaultFn !== void 0) {
							const defaultFnResult = col.defaultFn();
							defaultValue = is(defaultFnResult, SQL$1) ? defaultFnResult : sql$1.param(defaultFnResult, col);
						} else if (!col.default && col.onUpdateFn !== void 0) {
							const onUpdateFnResult = col.onUpdateFn();
							defaultValue = is(onUpdateFnResult, SQL$1) ? onUpdateFnResult : sql$1.param(onUpdateFnResult, col);
						} else defaultValue = sql$1`null`;
						valueList.push(defaultValue);
					} else valueList.push(colValue);
				}
				valuesSqlList.push(valueList);
				if (valueIndex < values.length - 1) valuesSqlList.push(sql$1`, `);
			}
		}
		const withSql = this.buildWithCTE(withList);
		const valuesSql = sql$1.join(valuesSqlList);
		const returningSql = returning ? sql$1` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
		return sql$1`${withSql}insert into ${table} ${insertOrder} ${valuesSql}${onConflict?.length ? sql$1.join(onConflict) : void 0}${returningSql}`;
	}
	sqlToQuery(sql, invokeSource) {
		return sql.toQuery({
			escapeName: this.escapeName,
			escapeParam: this.escapeParam,
			escapeString: this.escapeString,
			invokeSource
		});
	}
	/** @deprecated */
	_buildRelationalQuery({ fullSchema, schema, tableNamesMap, table, tableConfig, queryConfig: config, tableAlias, nestedQueryRelation, joinOn }) {
		let selection = [];
		let limit, offset, orderBy = [], where;
		const joins = [];
		if (config === true) selection = Object.entries(tableConfig.columns).map(([key, value]) => ({
			dbKey: value.name,
			tsKey: key,
			field: aliasedTableColumn(value, tableAlias),
			relationTableTsKey: void 0,
			isJson: false,
			selection: []
		}));
		else {
			const aliasedColumns = Object.fromEntries(Object.entries(tableConfig.columns).map(([key, value]) => [key, aliasedTableColumn(value, tableAlias)]));
			if (config.where) {
				const whereSql = typeof config.where === "function" ? config.where(aliasedColumns, getOperators()) : config.where;
				where = whereSql && mapColumnsInSQLToAlias(whereSql, tableAlias);
			}
			const fieldsSelection = [];
			let selectedColumns = [];
			if (config.columns) {
				let isIncludeMode = false;
				for (const [field, value] of Object.entries(config.columns)) {
					if (value === void 0) continue;
					if (field in tableConfig.columns) {
						if (!isIncludeMode && value === true) isIncludeMode = true;
						selectedColumns.push(field);
					}
				}
				if (selectedColumns.length > 0) selectedColumns = isIncludeMode ? selectedColumns.filter((c) => config.columns?.[c] === true) : Object.keys(tableConfig.columns).filter((key) => !selectedColumns.includes(key));
			} else selectedColumns = Object.keys(tableConfig.columns);
			for (const field of selectedColumns) {
				const column = tableConfig.columns[field];
				fieldsSelection.push({
					tsKey: field,
					value: column
				});
			}
			let selectedRelations = [];
			if (config.with) selectedRelations = Object.entries(config.with).filter((entry) => !!entry[1]).map(([tsKey, queryConfig]) => ({
				tsKey,
				queryConfig,
				relation: tableConfig.relations[tsKey]
			}));
			let extras;
			if (config.extras) {
				extras = typeof config.extras === "function" ? config.extras(aliasedColumns, { sql: sql$1 }) : config.extras;
				for (const [tsKey, value] of Object.entries(extras)) fieldsSelection.push({
					tsKey,
					value: mapColumnsInAliasedSQLToAlias(value, tableAlias)
				});
			}
			for (const { tsKey, value } of fieldsSelection) selection.push({
				dbKey: is(value, SQL$1.Aliased) ? value.fieldAlias : tableConfig.columns[tsKey].name,
				tsKey,
				field: is(value, Column) ? aliasedTableColumn(value, tableAlias) : value,
				relationTableTsKey: void 0,
				isJson: false,
				selection: []
			});
			let orderByOrig = typeof config.orderBy === "function" ? config.orderBy(aliasedColumns, getOrderByOperators()) : config.orderBy ?? [];
			if (!Array.isArray(orderByOrig)) orderByOrig = [orderByOrig];
			orderBy = orderByOrig.map((orderByValue) => {
				if (is(orderByValue, Column)) return aliasedTableColumn(orderByValue, tableAlias);
				return mapColumnsInSQLToAlias(orderByValue, tableAlias);
			});
			limit = config.limit;
			offset = config.offset;
			for (const { tsKey: selectedRelationTsKey, queryConfig: selectedRelationConfigValue, relation } of selectedRelations) {
				const normalizedRelation = normalizeRelation(schema, tableNamesMap, relation);
				const relationTableTsName = tableNamesMap[getTableUniqueName(relation.referencedTable)];
				const relationTableAlias = `${tableAlias}_${selectedRelationTsKey}`;
				const joinOn = and(...normalizedRelation.fields.map((field, i) => eq(aliasedTableColumn(normalizedRelation.references[i], relationTableAlias), aliasedTableColumn(field, tableAlias))));
				const builtRelation = this._buildRelationalQuery({
					fullSchema,
					schema,
					tableNamesMap,
					table: fullSchema[relationTableTsName],
					tableConfig: schema[relationTableTsName],
					queryConfig: is(relation, One) ? selectedRelationConfigValue === true ? { limit: 1 } : {
						...selectedRelationConfigValue,
						limit: 1
					} : selectedRelationConfigValue,
					tableAlias: relationTableAlias,
					joinOn,
					nestedQueryRelation: relation
				});
				const field = sql$1`(${builtRelation.sql})`.as(selectedRelationTsKey);
				selection.push({
					dbKey: selectedRelationTsKey,
					tsKey: selectedRelationTsKey,
					field,
					relationTableTsKey: relationTableTsName,
					isJson: true,
					selection: builtRelation.selection
				});
			}
		}
		if (selection.length === 0) throw new DrizzleError({ message: `No fields selected for table "${tableConfig.tsName}" ("${tableAlias}"). You need to have at least one item in "columns", "with" or "extras". If you need to select all columns, omit the "columns" key or set it to undefined.` });
		let result;
		where = and(joinOn, where);
		if (nestedQueryRelation) {
			let field = sql$1`json_array(${sql$1.join(selection.map(({ field }) => is(field, SQLiteColumn) ? sql$1.identifier(field.name) : is(field, SQL$1.Aliased) ? field.sql : field), sql$1`, `)})`;
			if (is(nestedQueryRelation, Many)) field = sql$1`coalesce(json_group_array(${field}), json_array())`;
			const nestedSelection = [{
				dbKey: "data",
				tsKey: "data",
				field: field.as("data"),
				isJson: true,
				relationTableTsKey: tableConfig.tsName,
				selection
			}];
			if (limit !== void 0 || offset !== void 0 || orderBy.length > 0) {
				result = this.buildSelectQuery({
					table: aliasedTable(table, tableAlias),
					fields: {},
					fieldsFlat: [{
						path: [],
						field: sql$1.raw("*")
					}],
					where,
					limit,
					offset,
					orderBy,
					setOperators: []
				});
				where = void 0;
				limit = void 0;
				offset = void 0;
				orderBy = void 0;
			} else result = aliasedTable(table, tableAlias);
			result = this.buildSelectQuery({
				table: is(result, SQLiteTable) ? result : new Subquery(result, {}, tableAlias),
				fields: {},
				fieldsFlat: nestedSelection.map(({ field }) => ({
					path: [],
					field: is(field, Column) ? aliasedTableColumn(field, tableAlias) : field
				})),
				joins,
				where,
				limit,
				offset,
				orderBy,
				setOperators: []
			});
		} else result = this.buildSelectQuery({
			table: aliasedTable(table, tableAlias),
			fields: {},
			fieldsFlat: selection.map(({ field }) => ({
				path: [],
				field: is(field, Column) ? aliasedTableColumn(field, tableAlias) : field
			})),
			joins,
			where,
			limit,
			offset,
			orderBy,
			setOperators: []
		});
		return {
			tableTsKey: tableConfig.tsName,
			sql: result,
			selection
		};
	}
	nestedSelectionerror() {
		throw new DrizzleError({ message: `Views with nested selections are not supported by the relational query builder` });
	}
	buildRqbColumn(table, column, key) {
		if (is(column, Column)) {
			const name = sql$1`${table}.${sql$1.identifier(column.name)}`;
			switch (column.columnType) {
				case "SQLiteBigInt":
				case "SQLiteBlobJson":
				case "SQLiteBlobBuffer": return sql$1`hex(${name}) as ${sql$1.identifier(key)}`;
				case "SQLiteNumeric":
				case "SQLiteNumericNumber":
				case "SQLiteNumericBigInt": return sql$1`cast(${name} as text) as ${sql$1.identifier(key)}`;
				case "SQLiteCustomColumn": return sql$1`${column.jsonSelectIdentifier(name, sql$1)} as ${sql$1.identifier(key)}`;
				default: return sql$1`${name} as ${sql$1.identifier(key)}`;
			}
		}
		return sql$1`${table}.${is(column, SQL$1.Aliased) ? sql$1.identifier(column.fieldAlias) : isSQLWrapper(column) ? sql$1.identifier(key) : this.nestedSelectionerror()} as ${sql$1.identifier(key)}`;
	}
	unwrapAllColumns = (table, selection) => {
		return sql$1.join(Object.entries(table[TableColumns]).map(([k, v]) => {
			selection.push({
				key: k,
				field: v
			});
			return this.buildRqbColumn(table, v, k);
		}), sql$1`, `);
	};
	getSelectedTableColumns = (table, columns) => {
		const selectedColumns = [];
		const columnContainer = table[TableColumns];
		const entries = Object.entries(columns);
		let colSelectionMode;
		for (const [k, v] of entries) {
			if (v === void 0) continue;
			colSelectionMode = colSelectionMode || v;
			if (v) {
				const column = columnContainer[k];
				selectedColumns.push({
					column,
					tsName: k
				});
			}
		}
		if (colSelectionMode === false) for (const [k, v] of Object.entries(columnContainer)) {
			if (columns[k] === false) continue;
			selectedColumns.push({
				column: v,
				tsName: k
			});
		}
		return selectedColumns;
	};
	buildColumns = (table, selection, params) => params?.columns ? (() => {
		const columnIdentifiers = [];
		const selectedColumns = this.getSelectedTableColumns(table, params?.columns);
		for (const { column, tsName } of selectedColumns) {
			columnIdentifiers.push(this.buildRqbColumn(table, column, tsName));
			selection.push({
				key: tsName,
				field: column
			});
		}
		return columnIdentifiers.length ? sql$1.join(columnIdentifiers, sql$1`, `) : void 0;
	})() : this.unwrapAllColumns(table, selection);
	buildRelationalQuery({ schema, table, tableConfig, queryConfig: config, relationWhere, mode, isNested, errorPath, depth, throughJoin, jsonb }) {
		const selection = [];
		const isSingle = mode === "first";
		const params = config === true ? void 0 : config;
		const currentPath = errorPath ?? "";
		const currentDepth = depth ?? 0;
		if (!currentDepth) table = aliasedTable(table, `d${currentDepth}`);
		const limit = isSingle ? 1 : params?.limit;
		const offset = params?.offset;
		const columns = this.buildColumns(table, selection, params);
		const where = params?.where && relationWhere ? and(relationsFilterToSQL(table, params.where, tableConfig.relations, schema), relationWhere) : params?.where ? relationsFilterToSQL(table, params.where, tableConfig.relations, schema) : relationWhere;
		const order = params?.orderBy ? relationsOrderToSQL(table, params.orderBy) : void 0;
		const extras = params?.extras ? relationExtrasToSQL(table, params.extras) : void 0;
		if (extras) selection.push(...extras.selection);
		const joins = params ? (() => {
			const { with: joins } = params;
			if (!joins) return;
			const withEntries = Object.entries(joins).filter(([_, v]) => v);
			if (!withEntries.length) return;
			return sql$1.join(withEntries.map(([k, join]) => {
				const relation = tableConfig.relations[k];
				const isSingle = is(relation, One$1);
				const targetTable = aliasedTable(relation.targetTable, `d${currentDepth + 1}`);
				const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `tr${currentDepth}`) : void 0;
				const { filter, joinCondition } = relationToSQL(relation, table, targetTable, throughTable);
				const throughJoin = throughTable ? sql$1` inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}` : void 0;
				const innerQuery = this.buildRelationalQuery({
					table: targetTable,
					mode: isSingle ? "first" : "many",
					schema,
					queryConfig: join,
					tableConfig: schema[relation.targetTableName],
					relationWhere: filter,
					isNested: true,
					errorPath: `${currentPath.length ? `${currentPath}.` : ""}${k}`,
					depth: currentDepth + 1,
					throughJoin,
					jsonb
				});
				selection.push({
					field: targetTable,
					key: k,
					selection: innerQuery.selection,
					isArray: !isSingle,
					isOptional: (relation.optional ?? false) || join !== true && !!join.where
				});
				const jsonColumns = sql$1.join(innerQuery.selection.map((s) => {
					return sql$1`${sql$1.raw(this.escapeString(s.key))}, ${s.selection ? sql$1`${jsonb}(${sql$1.identifier(s.key)})` : sql$1.identifier(s.key)}`;
				}), sql$1`, `);
				const json = isNested ? jsonb : sql$1`json`;
				return isSingle ? sql$1`(select ${json}_object(${jsonColumns}) as ${sql$1.identifier("r")} from (${innerQuery.sql}) as ${sql$1.identifier("t")}) as ${sql$1.identifier(k)}` : sql$1`coalesce((select ${json}_group_array(json_object(${jsonColumns})) as ${sql$1.identifier("r")} from (${innerQuery.sql}) as ${sql$1.identifier("t")}), ${jsonb}_array()) as ${sql$1.identifier(k)}`;
			}), sql$1`, `);
		})() : void 0;
		const selectionArr = [
			columns,
			extras?.sql,
			joins
		].filter((e) => e !== void 0);
		if (!selectionArr.length) throw new DrizzleError({ message: `No fields selected for table "${tableConfig.name}"${currentPath ? ` ("${currentPath}")` : ""}` });
		return {
			sql: sql$1`select ${sql$1.join(selectionArr, sql$1`, `)} from ${getTableAsAliasSQL(table)}${throughJoin}${sql$1` where ${where}`.if(where)}${sql$1` order by ${order}`.if(order)}${sql$1` limit ${limit}`.if(limit !== void 0)}${sql$1` offset ${offset}`.if(offset !== void 0)}`,
			selection
		};
	}
};
var SQLiteSyncDialect = class extends SQLiteDialect {
	static [entityKind] = "SQLiteSyncDialect";
	migrate(migrations, session, config) {
		const migrationsTable = config === void 0 ? "__drizzle_migrations" : typeof config === "string" ? "__drizzle_migrations" : config.migrationsTable ?? "__drizzle_migrations";
		const { newDb } = upgradeSyncIfNeeded(migrationsTable, session, migrations);
		if (newDb) {
			const migrationTableCreate = sql$1`
			CREATE TABLE IF NOT EXISTS ${sql$1.identifier(migrationsTable)} (
				id INTEGER PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric,
				name text,
				applied_at TEXT
			)`;
			session.run(migrationTableCreate);
		}
		const dbMigrations = session.all(sql$1`SELECT id, hash, created_at, name FROM ${sql$1.identifier(migrationsTable)}`);
		if (typeof config === "object" && config.init) {
			if (dbMigrations.length) return { exitCode: "databaseMigrations" };
			if (migrations.length > 1) return { exitCode: "localMigrations" };
			const [migration] = migrations;
			if (!migration) return;
			session.run(sql$1`insert into ${sql$1.identifier(migrationsTable)} ("hash", "created_at", "name", "applied_at") values(${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${(/* @__PURE__ */ new Date()).toISOString()})`);
			return;
		}
		const migrationsToRun = getMigrationsToRun({
			localMigrations: migrations,
			dbMigrations
		});
		session.run(sql$1`BEGIN`);
		try {
			for (const migration of migrationsToRun) {
				for (const stmt of migration.sql) session.run(sql$1.raw(stmt));
				session.run(sql$1`INSERT INTO ${sql$1.identifier(migrationsTable)} ("hash", "created_at", "name", "applied_at") values(${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${(/* @__PURE__ */ new Date()).toISOString()})`);
			}
			session.run(sql$1`COMMIT`);
		} catch (e) {
			session.run(sql$1`ROLLBACK`);
			throw e;
		}
	}
};
var SQLiteAsyncDialect = class extends SQLiteDialect {
	static [entityKind] = "SQLiteAsyncDialect";
	async migrate(migrations, db, config) {
		const migrationsTable = config === void 0 ? "__drizzle_migrations" : typeof config === "string" ? "__drizzle_migrations" : config.migrationsTable ?? "__drizzle_migrations";
		const { newDb } = await upgradeAsyncIfNeeded(migrationsTable, db, migrations);
		if (newDb) {
			const migrationTableCreate = sql$1`
			CREATE TABLE IF NOT EXISTS ${sql$1.identifier(migrationsTable)} (
				id INTEGER PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric,
				name text,
				applied_at TEXT
		)
		`;
			await db.session.run(migrationTableCreate);
		}
		const dbMigrations = await db.session.all(sql$1`SELECT id, hash, created_at, name FROM ${sql$1.identifier(migrationsTable)};`);
		if (typeof config === "object" && config.init) {
			if (dbMigrations.length) return { exitCode: "databaseMigrations" };
			if (migrations.length > 1) return { exitCode: "localMigrations" };
			const [migration] = migrations;
			if (!migration) return;
			await db.session.run(sql$1`insert into ${sql$1.identifier(migrationsTable)} ("hash", "created_at", "name", "applied_at") values(${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${(/* @__PURE__ */ new Date()).toISOString()})`);
			return;
		}
		const migrationsToRun = getMigrationsToRun({
			localMigrations: migrations,
			dbMigrations
		});
		await db.session.transaction(async (tx) => {
			for (const migration of migrationsToRun) {
				for (const stmt of migration.sql) await tx.run(sql$1.raw(stmt));
				await tx.run(sql$1`insert into ${sql$1.identifier(migrationsTable)} ("hash", "created_at", "name", "applied_at") values(${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${(/* @__PURE__ */ new Date()).toISOString()})`);
			}
		});
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/query-builder.js
var QueryBuilder = class {
	static [entityKind] = "SQLiteQueryBuilder";
	dialect;
	dialectConfig;
	constructor(dialect) {
		this.dialect = is(dialect, SQLiteDialect) ? dialect : void 0;
		this.dialectConfig = is(dialect, SQLiteDialect) ? void 0 : dialect;
	}
	$with = (alias, selection) => {
		const queryBuilder = this;
		const as = (qb) => {
			if (typeof qb === "function") qb = qb(queryBuilder);
			return new Proxy(new WithSubquery(qb.getSQL(), selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true), new SelectionProxyHandler({
				alias,
				sqlAliasedBehavior: "alias",
				sqlBehavior: "error"
			}));
		};
		return { as };
	};
	with(...queries) {
		const self = this;
		function select(fields) {
			return new SQLiteSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				withList: queries
			});
		}
		function selectDistinct(fields) {
			return new SQLiteSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				withList: queries,
				distinct: true
			});
		}
		return {
			select,
			selectDistinct
		};
	}
	select(fields) {
		return new SQLiteSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect()
		});
	}
	selectDistinct(fields) {
		return new SQLiteSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect(),
			distinct: true
		});
	}
	getDialect() {
		if (!this.dialect) this.dialect = new SQLiteSyncDialect(this.dialectConfig);
		return this.dialect;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/delete.js
var SQLiteDeleteBase = class extends QueryPromise {
	static [entityKind] = "SQLiteDelete";
	/** @internal */
	config;
	constructor(table, session, dialect, withList) {
		super();
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.config = {
			table,
			withList
		};
	}
	/**
	* Adds a `where` clause to the query.
	*
	* Calling this method will delete only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/delete}
	*
	* @param where the `where` clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be deleted.
	*
	* ```ts
	* // Delete all cars with green color
	* db.delete(cars).where(eq(cars.color, 'green'));
	* // or
	* db.delete(cars).where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Delete all BMW cars with a green color
	* db.delete(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Delete all cars with the green or blue color
	* db.delete(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		this.config.where = where;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			this.config.orderBy = orderByArray;
		}
		return this;
	}
	limit(limit) {
		this.config.limit = limit;
		return this;
	}
	returning(fields = this.table[SQLiteTable.Symbol.Columns]) {
		this.config.returning = orderSelectedFields(fields);
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildDeleteQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	/** @internal */
	_prepare(isOneTimeQuery = true) {
		return this.session[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](this.dialect.sqlToQuery(this.getSQL()), this.config.returning, this.config.returning ? "all" : "run", void 0, {
			type: "delete",
			tables: extractUsedTable(this.config.table)
		});
	}
	prepare() {
		return this._prepare(false);
	}
	run = (placeholderValues) => {
		return this._prepare().run(placeholderValues);
	};
	all = (placeholderValues) => {
		return this._prepare().all(placeholderValues);
	};
	get = (placeholderValues) => {
		return this._prepare().get(placeholderValues);
	};
	values = (placeholderValues) => {
		return this._prepare().values(placeholderValues);
	};
	async execute(placeholderValues) {
		return this._prepare().execute(placeholderValues);
	}
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/insert.js
var SQLiteInsertBuilder = class {
	static [entityKind] = "SQLiteInsertBuilder";
	constructor(table, session, dialect, withList) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.withList = withList;
	}
	values(values) {
		values = Array.isArray(values) ? values : [values];
		if (values.length === 0) throw new Error("values() must be called with at least one value");
		const mappedValues = values.map((entry) => {
			const result = {};
			const cols = this.table[Table.Symbol.Columns];
			for (const colKey of Object.keys(entry)) {
				const colValue = entry[colKey];
				result[colKey] = is(colValue, SQL$1) ? colValue : new Param(colValue, cols[colKey]);
			}
			return result;
		});
		return new SQLiteInsertBase(this.table, mappedValues, this.session, this.dialect, this.withList);
	}
	select(selectQuery) {
		const select = typeof selectQuery === "function" ? selectQuery(new QueryBuilder()) : selectQuery;
		if (!is(select, SQL$1) && !haveSameKeys(this.table[TableColumns], select._.selectedFields)) throw new Error("Insert select error: selected fields are not the same or are in a different order compared to the table definition");
		return new SQLiteInsertBase(this.table, select, this.session, this.dialect, this.withList, true);
	}
};
var SQLiteInsertBase = class extends QueryPromise {
	static [entityKind] = "SQLiteInsert";
	/** @internal */
	config;
	constructor(table, values, session, dialect, withList, select) {
		super();
		this.session = session;
		this.dialect = dialect;
		this.config = {
			table,
			values,
			withList,
			select
		};
	}
	returning(fields = this.config.table[SQLiteTable.Symbol.Columns]) {
		this.config.returning = orderSelectedFields(fields);
		return this;
	}
	/**
	* Adds an `on conflict do nothing` clause to the query.
	*
	* Calling this method simply avoids inserting a row as its alternative action.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert#on-conflict-do-nothing}
	*
	* @param config The `target` and `where` clauses.
	*
	* @example
	* ```ts
	* // Insert one row and cancel the insert if there's a conflict
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoNothing();
	*
	* // Explicitly specify conflict target
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoNothing({ target: cars.id });
	* ```
	*/
	onConflictDoNothing(config = {}) {
		if (!this.config.onConflict) this.config.onConflict = [];
		if (config.target === void 0) this.config.onConflict.push(sql$1` on conflict do nothing`);
		else {
			const targetSql = Array.isArray(config.target) ? sql$1`${config.target}` : sql$1`${[config.target]}`;
			const whereSql = config.where ? sql$1` where ${config.where}` : sql$1``;
			this.config.onConflict.push(sql$1` on conflict ${targetSql} do nothing${whereSql}`);
		}
		return this;
	}
	/**
	* Adds an `on conflict do update` clause to the query.
	*
	* Calling this method will update the existing row that conflicts with the row proposed for insertion as its alternative action.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert#upserts-and-conflicts}
	*
	* @param config The `target`, `set` and `where` clauses.
	*
	* @example
	* ```ts
	* // Update the row if there's a conflict
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoUpdate({
	*     target: cars.id,
	*     set: { brand: 'Porsche' }
	*   });
	*
	* // Upsert with 'where' clause
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoUpdate({
	*     target: cars.id,
	*     set: { brand: 'newBMW' },
	*     where: sql`${cars.createdAt} > '2023-01-01'::date`,
	*   });
	* ```
	*/
	onConflictDoUpdate(config) {
		if (config.where && (config.targetWhere || config.setWhere)) throw new Error("You cannot use both \"where\" and \"targetWhere\"/\"setWhere\" at the same time - \"where\" is deprecated, use \"targetWhere\" or \"setWhere\" instead.");
		if (!this.config.onConflict) this.config.onConflict = [];
		const whereSql = config.where ? sql$1` where ${config.where}` : void 0;
		const targetWhereSql = config.targetWhere ? sql$1` where ${config.targetWhere}` : void 0;
		const setWhereSql = config.setWhere ? sql$1` where ${config.setWhere}` : void 0;
		const targetSql = Array.isArray(config.target) ? sql$1`${config.target}` : sql$1`${[config.target]}`;
		const setSql = this.dialect.buildUpdateSet(this.config.table, mapUpdateSet(this.config.table, config.set));
		this.config.onConflict.push(sql$1` on conflict ${targetSql}${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}`);
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildInsertQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	/** @internal */
	_prepare(isOneTimeQuery = true) {
		return this.session[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](this.dialect.sqlToQuery(this.getSQL()), this.config.returning, this.config.returning ? "all" : "run", void 0, {
			type: "insert",
			tables: extractUsedTable(this.config.table)
		});
	}
	prepare() {
		return this._prepare(false);
	}
	run = (placeholderValues) => {
		return this._prepare().run(placeholderValues);
	};
	all = (placeholderValues) => {
		return this._prepare().all(placeholderValues);
	};
	get = (placeholderValues) => {
		return this._prepare().get(placeholderValues);
	};
	values = (placeholderValues) => {
		return this._prepare().values(placeholderValues);
	};
	async execute() {
		return this.config.returning ? this.all() : this.run();
	}
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/query-builders/update.js
var SQLiteUpdateBuilder = class {
	static [entityKind] = "SQLiteUpdateBuilder";
	constructor(table, session, dialect, withList) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.withList = withList;
	}
	set(values) {
		return new SQLiteUpdateBase(this.table, mapUpdateSet(this.table, values), this.session, this.dialect, this.withList);
	}
};
var SQLiteUpdateBase = class extends QueryPromise {
	static [entityKind] = "SQLiteUpdate";
	/** @internal */
	config;
	constructor(table, set, session, dialect, withList) {
		super();
		this.session = session;
		this.dialect = dialect;
		this.config = {
			set,
			table,
			withList,
			joins: []
		};
	}
	from(source) {
		this.config.from = source;
		return this;
	}
	createJoin(joinType) {
		return ((table, on) => {
			const tableName = getTableLikeName(table);
			if (typeof tableName === "string" && this.config.joins.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
			if (typeof on === "function") {
				const from = this.config.from ? is(table, SQLiteTable) ? table[Table.Symbol.Columns] : is(table, Subquery) ? table._.selectedFields : is(table, SQLiteViewBase) ? table[ViewBaseConfig].selectedFields : void 0 : void 0;
				on = on(new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
					sqlAliasedBehavior: "sql",
					sqlBehavior: "sql"
				})), from && new Proxy(from, new SelectionProxyHandler({
					sqlAliasedBehavior: "sql",
					sqlBehavior: "sql"
				})));
			}
			this.config.joins.push({
				on,
				table,
				joinType,
				alias: tableName
			});
			return this;
		});
	}
	leftJoin = this.createJoin("left");
	rightJoin = this.createJoin("right");
	innerJoin = this.createJoin("inner");
	fullJoin = this.createJoin("full");
	/**
	* Adds a 'where' clause to the query.
	*
	* Calling this method will update only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/update}
	*
	* @param where the 'where' clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be updated.
	*
	* ```ts
	* // Update all cars with green color
	* db.update(cars).set({ color: 'red' })
	*   .where(eq(cars.color, 'green'));
	* // or
	* db.update(cars).set({ color: 'red' })
	*   .where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Update all BMW cars with a green color
	* db.update(cars).set({ color: 'red' })
	*   .where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Update all cars with the green or blue color
	* db.update(cars).set({ color: 'red' })
	*   .where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		this.config.where = where;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			this.config.orderBy = orderByArray;
		}
		return this;
	}
	limit(limit) {
		this.config.limit = limit;
		return this;
	}
	returning(fields = this.config.table[SQLiteTable.Symbol.Columns]) {
		this.config.returning = orderSelectedFields(fields);
		return this;
	}
	/** @internal */
	getSQL() {
		return this.dialect.buildUpdateQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	/** @internal */
	_prepare(isOneTimeQuery = true) {
		return this.session[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](this.dialect.sqlToQuery(this.getSQL()), this.config.returning, this.config.returning ? "all" : "run", void 0, {
			type: "insert",
			tables: extractUsedTable(this.config.table)
		});
	}
	prepare() {
		return this._prepare(false);
	}
	run = (placeholderValues) => {
		return this._prepare().run(placeholderValues);
	};
	all = (placeholderValues) => {
		return this._prepare().all(placeholderValues);
	};
	get = (placeholderValues) => {
		return this._prepare().get(placeholderValues);
	};
	values = (placeholderValues) => {
		return this._prepare().values(placeholderValues);
	};
	async execute() {
		return this.config.returning ? this.all() : this.run();
	}
	$dynamic() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/db.js
var BaseSQLiteDatabase = class {
	static [entityKind] = "BaseSQLiteDatabase";
	/** @deprecated */
	_query;
	query;
	constructor(resultKind, dialect, session, relations, _schema, rowModeRQB, forbidJsonb) {
		this.resultKind = resultKind;
		this.dialect = dialect;
		this.session = session;
		this.rowModeRQB = rowModeRQB;
		this.forbidJsonb = forbidJsonb;
		this._ = _schema ? {
			schema: _schema.schema,
			fullSchema: _schema.fullSchema,
			tableNamesMap: _schema.tableNamesMap,
			relations
		} : {
			schema: void 0,
			fullSchema: {},
			tableNamesMap: {},
			relations
		};
		this._query = {};
		const query = this._query;
		if (this._.schema) for (const [tableName, columns] of Object.entries(this._.schema)) query[tableName] = new _RelationalQueryBuilder(resultKind, _schema.fullSchema, this._.schema, this._.tableNamesMap, _schema.fullSchema[tableName], columns, dialect, session);
		this.query = {};
		for (const [tableName, relation] of Object.entries(relations)) this.query[tableName] = new RelationalQueryBuilder(resultKind, relations, relations[relation.name].table, relation, dialect, session, rowModeRQB, forbidJsonb);
		this.$cache = { invalidate: async (_params) => {} };
	}
	/**
	* Creates a subquery that defines a temporary named result set as a CTE.
	*
	* It is useful for breaking down complex queries into simpler parts and for reusing the result set in subsequent parts of the query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
	*
	* @param alias The alias for the subquery.
	*
	* Failure to provide an alias will result in a DrizzleTypeError, preventing the subquery from being referenced in other queries.
	*
	* @example
	*
	* ```ts
	* // Create a subquery with alias 'sq' and use it in the select query
	* const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
	*
	* const result = await db.with(sq).select().from(sq);
	* ```
	*
	* To select arbitrary SQL values as fields in a CTE and reference them in other CTEs or in the main query, you need to add aliases to them:
	*
	* ```ts
	* // Select an arbitrary SQL value as a field in a CTE and reference it in the main query
	* const sq = db.$with('sq').as(db.select({
	*   name: sql<string>`upper(${users.name})`.as('name'),
	* })
	* .from(users));
	*
	* const result = await db.with(sq).select({ name: sq.name }).from(sq);
	* ```
	*/
	$with = (alias, selection) => {
		const self = this;
		const as = (qb) => {
			if (typeof qb === "function") qb = qb(new QueryBuilder(self.dialect));
			return new Proxy(new WithSubquery(qb.getSQL(), selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true), new SelectionProxyHandler({
				alias,
				sqlAliasedBehavior: "alias",
				sqlBehavior: "error"
			}));
		};
		return { as };
	};
	$count(source, filters) {
		return this.resultKind === "async" ? new SQLiteCountBuilder({
			source,
			filters,
			session: this.session,
			dialect: this.dialect
		}) : new SQLiteSyncCountBuilder({
			source,
			filters,
			session: this.session,
			dialect: this.dialect
		});
	}
	/**
	* Incorporates a previously defined CTE (using `$with`) into the main query.
	*
	* This method allows the main query to reference a temporary named result set.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
	*
	* @param queries The CTEs to incorporate into the main query.
	*
	* @example
	*
	* ```ts
	* // Define a subquery 'sq' as a CTE using $with
	* const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
	*
	* // Incorporate the CTE 'sq' into the main query and select from it
	* const result = await db.with(sq).select().from(sq);
	* ```
	*/
	with(...queries) {
		const self = this;
		function select(fields) {
			return new SQLiteSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries
			});
		}
		function selectDistinct(fields) {
			return new SQLiteSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries,
				distinct: true
			});
		}
		/**
		* Creates an update query.
		*
		* Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
		*
		* Use `.set()` method to specify which values to update.
		*
		* See docs: {@link https://orm.drizzle.team/docs/update}
		*
		* @param table The table to update.
		*
		* @example
		*
		* ```ts
		* // Update all rows in the 'cars' table
		* await db.update(cars).set({ color: 'red' });
		*
		* // Update rows with filters and conditions
		* await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
		*
		* // Update with returning clause
		* const updatedCar: Car[] = await db.update(cars)
		*   .set({ color: 'red' })
		*   .where(eq(cars.id, 1))
		*   .returning();
		* ```
		*/
		function update(table) {
			return new SQLiteUpdateBuilder(table, self.session, self.dialect, queries);
		}
		/**
		* Creates an insert query.
		*
		* Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
		*
		* See docs: {@link https://orm.drizzle.team/docs/insert}
		*
		* @param table The table to insert into.
		*
		* @example
		*
		* ```ts
		* // Insert one row
		* await db.insert(cars).values({ brand: 'BMW' });
		*
		* // Insert multiple rows
		* await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
		*
		* // Insert with returning clause
		* const insertedCar: Car[] = await db.insert(cars)
		*   .values({ brand: 'BMW' })
		*   .returning();
		* ```
		*/
		function insert(into) {
			return new SQLiteInsertBuilder(into, self.session, self.dialect, queries);
		}
		/**
		* Creates a delete query.
		*
		* Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
		*
		* See docs: {@link https://orm.drizzle.team/docs/delete}
		*
		* @param table The table to delete from.
		*
		* @example
		*
		* ```ts
		* // Delete all rows in the 'cars' table
		* await db.delete(cars);
		*
		* // Delete rows with filters and conditions
		* await db.delete(cars).where(eq(cars.color, 'green'));
		*
		* // Delete with returning clause
		* const deletedCar: Car[] = await db.delete(cars)
		*   .where(eq(cars.id, 1))
		*   .returning();
		* ```
		*/
		function delete_(from) {
			return new SQLiteDeleteBase(from, self.session, self.dialect, queries);
		}
		return {
			select,
			selectDistinct,
			update,
			insert,
			delete: delete_
		};
	}
	select(fields) {
		return new SQLiteSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect
		});
	}
	selectDistinct(fields) {
		return new SQLiteSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect,
			distinct: true
		});
	}
	/**
	* Creates an update query.
	*
	* Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
	*
	* Use `.set()` method to specify which values to update.
	*
	* See docs: {@link https://orm.drizzle.team/docs/update}
	*
	* @param table The table to update.
	*
	* @example
	*
	* ```ts
	* // Update all rows in the 'cars' table
	* await db.update(cars).set({ color: 'red' });
	*
	* // Update rows with filters and conditions
	* await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
	*
	* // Update with returning clause
	* const updatedCar: Car[] = await db.update(cars)
	*   .set({ color: 'red' })
	*   .where(eq(cars.id, 1))
	*   .returning();
	* ```
	*/
	update(table) {
		return new SQLiteUpdateBuilder(table, this.session, this.dialect);
	}
	$cache;
	/**
	* Creates an insert query.
	*
	* Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert}
	*
	* @param table The table to insert into.
	*
	* @example
	*
	* ```ts
	* // Insert one row
	* await db.insert(cars).values({ brand: 'BMW' });
	*
	* // Insert multiple rows
	* await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
	*
	* // Insert with returning clause
	* const insertedCar: Car[] = await db.insert(cars)
	*   .values({ brand: 'BMW' })
	*   .returning();
	* ```
	*/
	insert(into) {
		return new SQLiteInsertBuilder(into, this.session, this.dialect);
	}
	/**
	* Creates a delete query.
	*
	* Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
	*
	* See docs: {@link https://orm.drizzle.team/docs/delete}
	*
	* @param table The table to delete from.
	*
	* @example
	*
	* ```ts
	* // Delete all rows in the 'cars' table
	* await db.delete(cars);
	*
	* // Delete rows with filters and conditions
	* await db.delete(cars).where(eq(cars.color, 'green'));
	*
	* // Delete with returning clause
	* const deletedCar: Car[] = await db.delete(cars)
	*   .where(eq(cars.id, 1))
	*   .returning();
	* ```
	*/
	delete(from) {
		return new SQLiteDeleteBase(from, this.session, this.dialect);
	}
	run(query) {
		const sequel = typeof query === "string" ? sql$1.raw(query) : query.getSQL();
		if (this.resultKind === "async") return new SQLiteRaw(async () => this.session.run(sequel), () => sequel, "run", this.dialect, this.session.extractRawRunValueFromBatchResult.bind(this.session));
		return this.session.run(sequel);
	}
	all(query) {
		const sequel = typeof query === "string" ? sql$1.raw(query) : query.getSQL();
		if (this.resultKind === "async") return new SQLiteRaw(async () => this.session.all(sequel), () => sequel, "all", this.dialect, this.session.extractRawAllValueFromBatchResult.bind(this.session));
		return this.session.all(sequel);
	}
	get(query) {
		const sequel = typeof query === "string" ? sql$1.raw(query) : query.getSQL();
		if (this.resultKind === "async") return new SQLiteRaw(async () => this.session.get(sequel), () => sequel, "get", this.dialect, this.session.extractRawGetValueFromBatchResult.bind(this.session));
		return this.session.get(sequel);
	}
	values(query) {
		const sequel = typeof query === "string" ? sql$1.raw(query) : query.getSQL();
		if (this.resultKind === "async") return new SQLiteRaw(async () => this.session.values(sequel), () => sequel, "values", this.dialect, this.session.extractRawValuesValueFromBatchResult.bind(this.session));
		return this.session.values(sequel);
	}
	transaction(transaction, config) {
		return this.session.transaction(transaction, config);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sqlite-core/session.js
var ExecuteResultSync = class extends QueryPromise {
	static [entityKind] = "ExecuteResultSync";
	constructor(resultCb) {
		super();
		this.resultCb = resultCb;
	}
	async execute() {
		return this.resultCb();
	}
	sync() {
		return this.resultCb();
	}
};
var SQLitePreparedQuery = class {
	static [entityKind] = "PreparedQuery";
	/** @internal */
	joinsNotNullableMap;
	constructor(mode, executeMethod, query, cache, queryMetadata, cacheConfig) {
		this.mode = mode;
		this.executeMethod = executeMethod;
		this.query = query;
		this.cache = cache;
		this.queryMetadata = queryMetadata;
		this.cacheConfig = cacheConfig;
		if (cache && cache.strategy() === "all" && cacheConfig === void 0) this.cacheConfig = {
			enabled: true,
			autoInvalidate: true
		};
		if (!this.cacheConfig?.enabled) this.cacheConfig = void 0;
	}
	/** @internal */
	async queryWithCache(queryString, params, query) {
		if (this.cache === void 0 || is(this.cache, NoopCache) || this.queryMetadata === void 0) try {
			return await query();
		} catch (e) {
			throw new DrizzleQueryError(queryString, params, e);
		}
		if (this.cacheConfig && !this.cacheConfig.enabled) try {
			return await query();
		} catch (e) {
			throw new DrizzleQueryError(queryString, params, e);
		}
		if ((this.queryMetadata.type === "insert" || this.queryMetadata.type === "update" || this.queryMetadata.type === "delete") && this.queryMetadata.tables.length > 0) try {
			const [res] = await Promise.all([query(), this.cache.onMutate({ tables: this.queryMetadata.tables })]);
			return res;
		} catch (e) {
			throw new DrizzleQueryError(queryString, params, e);
		}
		if (!this.cacheConfig) try {
			return await query();
		} catch (e) {
			throw new DrizzleQueryError(queryString, params, e);
		}
		if (this.queryMetadata.type === "select") {
			const fromCache = await this.cache.get(this.cacheConfig.tag ?? await hashQuery(queryString, params), this.queryMetadata.tables, this.cacheConfig.tag !== void 0, this.cacheConfig.autoInvalidate);
			if (fromCache === void 0) {
				let result;
				try {
					result = await query();
				} catch (e) {
					throw new DrizzleQueryError(queryString, params, e);
				}
				await this.cache.put(this.cacheConfig.tag ?? await hashQuery(queryString, params), result, this.cacheConfig.autoInvalidate ? this.queryMetadata.tables : [], this.cacheConfig.tag !== void 0, this.cacheConfig.config);
				return result;
			}
			return fromCache;
		}
		try {
			return await query();
		} catch (e) {
			throw new DrizzleQueryError(queryString, params, e);
		}
	}
	getQuery() {
		return this.query;
	}
	mapRunResult(result, _isFromBatch) {
		return result;
	}
	mapAllResult(_result, _isFromBatch) {
		throw new Error("Not implemented");
	}
	mapGetResult(_result, _isFromBatch) {
		throw new Error("Not implemented");
	}
	execute(placeholderValues) {
		if (this.mode === "async") return this[this.executeMethod](placeholderValues);
		return new ExecuteResultSync(() => this[this.executeMethod](placeholderValues));
	}
	mapResult(response, isFromBatch) {
		switch (this.executeMethod) {
			case "run": return this.mapRunResult(response, isFromBatch);
			case "all": return this.mapAllResult(response, isFromBatch);
			case "get": return this.mapGetResult(response, isFromBatch);
		}
	}
};
var SQLiteSession = class {
	static [entityKind] = "SQLiteSession";
	constructor(dialect) {
		this.dialect = dialect;
	}
	prepareOneTimeQuery(query, fields, executeMethod, customResultMapper, queryMetadata, cacheConfig) {
		return this.prepareQuery(query, fields, executeMethod, customResultMapper, queryMetadata, cacheConfig);
	}
	prepareOneTimeRelationalQuery(query, fields, executeMethod, customResultMapper, config) {
		return this.prepareRelationalQuery(query, fields, executeMethod, customResultMapper, config);
	}
	run(query) {
		const staticQuery = this.dialect.sqlToQuery(query);
		try {
			return this.prepareOneTimeQuery(staticQuery, void 0, "run").run();
		} catch (err) {
			throw new DrizzleError({
				cause: err,
				message: `Failed to run the query '${staticQuery.sql}'`
			});
		}
	}
	/** @internal */
	extractRawRunValueFromBatchResult(result) {
		return result;
	}
	all(query) {
		return this.prepareOneTimeQuery(this.dialect.sqlToQuery(query), void 0, "run").all();
	}
	/** @internal */
	extractRawAllValueFromBatchResult(_result) {
		throw new Error("Not implemented");
	}
	get(query) {
		return this.prepareOneTimeQuery(this.dialect.sqlToQuery(query), void 0, "run").get();
	}
	/** @internal */
	extractRawGetValueFromBatchResult(_result) {
		throw new Error("Not implemented");
	}
	values(query) {
		return this.prepareOneTimeQuery(this.dialect.sqlToQuery(query), void 0, "run").values();
	}
	/** @internal */
	extractRawValuesValueFromBatchResult(_result) {
		throw new Error("Not implemented");
	}
};
var SQLiteTransaction = class extends BaseSQLiteDatabase {
	static [entityKind] = "SQLiteTransaction";
	constructor(resultType, dialect, session, relations, schema, nestedIndex = 0, rowModeRQB, forbidJsonb) {
		super(resultType, dialect, session, relations, schema, rowModeRQB, forbidJsonb);
		this.relations = relations;
		this.schema = schema;
		this.nestedIndex = nestedIndex;
	}
	rollback() {
		throw new TransactionRollbackError();
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/bun-sql/sqlite/session.js
var BunSQLiteSession = class BunSQLiteSession extends SQLiteSession {
	static [entityKind] = "BunSQLiteSession";
	logger;
	cache;
	constructor(client, dialect, relations, schema, options) {
		super(dialect);
		this.client = client;
		this.relations = relations;
		this.schema = schema;
		this.options = options;
		this.logger = options.logger ?? new NoopLogger();
		this.cache = options.cache ?? new NoopCache();
	}
	prepareQuery(query, fields, executeMethod, customResultMapper, queryMetadata, cacheConfig) {
		return new BunSQLitePreparedQuery(this.client, query, this.logger, this.cache, queryMetadata, cacheConfig, fields, executeMethod, this.options.useJitMappers, customResultMapper);
	}
	prepareRelationalQuery(query, fields, executeMethod, customResultMapper, config) {
		return new BunSQLitePreparedQuery(this.client, query, this.logger, this.cache, void 0, void 0, fields, executeMethod, this.options.useJitMappers, customResultMapper, true, config);
	}
	async run(query) {
		const staticQuery = this.dialect.sqlToQuery(query);
		try {
			return await this.prepareOneTimeQuery(staticQuery, void 0, "run").run();
		} catch (err) {
			throw new DrizzleError({
				cause: err,
				message: `Failed to run the query '${staticQuery.sql}'`
			});
		}
	}
	async transaction(transaction, config) {
		return this.client.begin(config?.behavior ?? "", async (client) => {
			const session = new BunSQLiteSession(client, this.dialect, this.relations, this.schema, this.options);
			return await transaction(new BunSQLiteTransaction("async", this.dialect, session, this.relations, this.schema));
		});
	}
};
var BunSQLiteTransaction = class BunSQLiteTransaction extends SQLiteTransaction {
	static [entityKind] = "BunSQLiteTransaction";
	async transaction(transaction) {
		return this.session.client.savepoint(async (client) => {
			const session = new BunSQLiteSession(client, this.session.dialect, this.relations, this.schema, this.session.options);
			return await transaction(new BunSQLiteTransaction("async", this.dialect, session, this.relations, this.schema, this.nestedIndex + 1));
		});
	}
};
var BunSQLitePreparedQuery = class extends SQLitePreparedQuery {
	static [entityKind] = "BunSQLitePreparedQuery";
	jitMapper;
	constructor(client, query, logger, cache, queryMetadata, cacheConfig, fields, executeMethod, useJitMappers, customResultMapper, isRqbV2Query, rqbConfig) {
		super("async", executeMethod, query, cache, queryMetadata, cacheConfig);
		this.client = client;
		this.logger = logger;
		this.fields = fields;
		this.useJitMappers = useJitMappers;
		this.customResultMapper = customResultMapper;
		this.isRqbV2Query = isRqbV2Query;
		this.rqbConfig = rqbConfig;
	}
	async run(placeholderValues = {}) {
		const { logger, query, client } = this;
		const params = fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(query.sql, params);
		return await this.queryWithCache(query.sql, params, async () => {
			return await client.unsafe(query.sql, params);
		});
	}
	async all(placeholderValues = {}) {
		if (this.isRqbV2Query) return this.allRqbV2(placeholderValues);
		const { logger, query, fields, joinsNotNullableMap, customResultMapper, client } = this;
		if (!fields && !customResultMapper) {
			const params = fillPlaceholders(query.params, placeholderValues);
			logger.logQuery(query.sql, params);
			return await this.queryWithCache(query.sql, params, async () => {
				return await client.unsafe(query.sql, params);
			});
		}
		const rows = await this.values(placeholderValues);
		if (customResultMapper) return customResultMapper(rows);
		return this.useJitMappers ? (this.jitMapper = this.jitMapper ?? makeJitQueryMapper(fields, joinsNotNullableMap))(rows) : rows.map((row) => mapResultRow(fields, row, joinsNotNullableMap));
	}
	async allRqbV2(placeholderValues = {}) {
		const { logger, query, customResultMapper, client } = this;
		const params = fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(query.sql, params);
		const rows = await client.unsafe(query.sql, params);
		return this.useJitMappers ? (this.jitMapper = this.jitMapper ?? makeJitRqbMapper(this.rqbConfig))(rows) : customResultMapper(rows);
	}
	async get(placeholderValues = {}) {
		if (this.isRqbV2Query) return this.getRqbV2(placeholderValues);
		const { logger, query, fields, joinsNotNullableMap, customResultMapper, client } = this;
		if (!fields && !customResultMapper) {
			const params = fillPlaceholders(query.params, placeholderValues);
			logger.logQuery(query.sql, params);
			return await this.queryWithCache(query.sql, params, async () => {
				return (await client.unsafe(query.sql, params))[0];
			});
		}
		const rows = await this.values(placeholderValues);
		const row = rows[0];
		if (customResultMapper) return customResultMapper(rows);
		if (row === void 0) return row;
		return this.useJitMappers ? (this.jitMapper = this.jitMapper ?? makeJitQueryMapper(fields, joinsNotNullableMap))([row])[0] : mapResultRow(fields, row, joinsNotNullableMap);
	}
	async getRqbV2(placeholderValues = {}) {
		const { logger, query, customResultMapper, client } = this;
		const params = fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(query.sql, params);
		const rows = await client.unsafe(query.sql, params);
		const row = rows[0];
		if (row === void 0) return row;
		return this.useJitMappers ? (this.jitMapper = this.jitMapper ?? makeJitRqbMapper(this.rqbConfig))(rows) : customResultMapper([row]);
	}
	async values(placeholderValues = {}) {
		const { client, logger, query } = this;
		const params = fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(query.sql, params);
		return await this.queryWithCache(query.sql, params, async () => {
			return await client.unsafe(query.sql, params).values();
		});
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/bun-sql/sqlite/driver.js
var BunSQLiteDatabase = class extends BaseSQLiteDatabase {
	static [entityKind] = "BunSQLiteDatabase";
};
function construct(client, config = {}) {
	const dialect = new SQLiteAsyncDialect();
	let logger;
	if (config.logger === true) logger = new DefaultLogger();
	else if (config.logger !== false) logger = config.logger;
	let schema;
	if (config.schema) {
		const tablesConfig = extractTablesRelationalConfig(config.schema, createTableRelationsHelpers);
		schema = {
			fullSchema: config.schema,
			schema: tablesConfig.tables,
			tableNamesMap: tablesConfig.tableNamesMap
		};
	}
	const relations = config.relations ?? {};
	const db = new BunSQLiteDatabase("async", dialect, new BunSQLiteSession(client, dialect, relations, schema, {
		logger,
		cache: config.cache,
		useJitMappers: jitCompatCheck(config.jit)
	}), relations, schema);
	db.$client = client;
	db.$cache = config.cache;
	if (db.$cache) db.$cache["invalidate"] = config.cache?.onMutate;
	return db;
}
function drizzle$1(...params) {
	if (typeof params[0] === "string") return construct(new SQL(params[0]), params[1]);
	const { connection, client, ...drizzleConfig } = params[0];
	if (client) return construct(client, drizzleConfig);
	if (typeof connection === "object" && connection.url !== void 0) {
		const { url, ...config } = connection;
		return construct(new SQL({
			url,
			...config
		}), drizzleConfig);
	}
	return construct(new SQL(connection), drizzleConfig);
}
(function(_drizzle) {
	function mock(config) {
		return construct({ options: {
			parsers: {},
			serializers: {}
		} }, config);
	}
	_drizzle.mock = mock;
})(drizzle$1 || (drizzle$1 = {}));
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/bun-sql/driver.js
function drizzle(...params) {
	return drizzle$2(...params);
}
(function(_drizzle) {
	function mock(config) {
		return drizzle$2.mock(config);
	}
	_drizzle.mock = mock;
	function postgres(...params) {
		return drizzle$2(...params);
	}
	_drizzle.postgres = postgres;
	(function(_postgres) {
		function mock(config) {
			return drizzle$2.mock(config);
		}
		_postgres.mock = mock;
	})(postgres || (postgres = _drizzle.postgres || (_drizzle.postgres = {})));
	function sqlite(...params) {
		return drizzle$1(...params);
	}
	_drizzle.sqlite = sqlite;
	(function(_sqlite) {
		function mock(config) {
			return drizzle$1.mock(config);
		}
		_sqlite.mock = mock;
	})(sqlite || (sqlite = _drizzle.sqlite || (_drizzle.sqlite = {})));
	function mysql(...params) {
		return drizzle$3(...params);
	}
	_drizzle.mysql = mysql;
	(function(_mysql) {
		function mock(config) {
			return drizzle$3.mock(config);
		}
		_mysql.mock = mock;
	})(mysql || (mysql = _drizzle.mysql || (_drizzle.mysql = {})));
})(drizzle || (drizzle = {}));
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/pg-core/columns/bytea.js
var PgByteaBuilder = class extends PgColumnBuilder {
	static [entityKind] = "PgByteaBuilder";
	constructor(name) {
		super(name, "object buffer", "PgBytea");
	}
	/** @internal */
	build(table) {
		return new PgBytea(table, this.config);
	}
};
var PgBytea = class extends PgColumn {
	static [entityKind] = "PgBytea";
	/** @internal */
	codec = "bytea";
	getSQLType() {
		return "bytea";
	}
};
function bytea(name) {
	return new PgByteaBuilder(name ?? "");
}
pgTable("user_groups", {
	key: varchar("key", { length: 50 }).primaryKey(),
	name: varchar("name", { length: 100 }).notNull(),
	description: text$1("description"),
	allowedChannelTypes: jsonb("allowed_channel_types").$type().default([]),
	deniedChannelTypes: jsonb("denied_channel_types").$type().default([]),
	allowedModels: jsonb("allowed_models").$type().default([]),
	deniedModels: jsonb("denied_models").$type().default([]),
	allowedPackages: jsonb("allowed_packages").$type().default([]),
	status: integer$1("status").notNull().default(1),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
var organizations = pgTable("organizations", {
	id: serial("id").primaryKey(),
	slug: varchar("slug", { length: 80 }).unique(),
	name: varchar("name", { length: 120 }).notNull(),
	billingEmail: text$1("billing_email"),
	quota: bigint("quota", { mode: "number" }).notNull().default(0),
	usedQuota: bigint("used_quota", { mode: "number" }).notNull().default(0),
	allowedModels: jsonb("allowed_models").$type().notNull().default([]),
	deniedModels: jsonb("denied_models").$type().notNull().default([]),
	allowedSubnets: text$1("allowed_subnets").notNull().default(""),
	quotaAlarmThreshold: integer$1("quota_alarm_threshold").notNull().default(80),
	alertThresholdPct: integer$1("alert_threshold_pct").notNull().default(80),
	alertWebhookUrl: text$1("alert_webhook_url"),
	lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
	status: integer$1("status").notNull().default(1),
	metadata: jsonb("metadata").$type().notNull().default({}),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
var users = pgTable("users", {
	id: serial("id").primaryKey(),
	username: text$1("username").notNull().unique(),
	email: text$1("email"),
	emailVerified: boolean("email_verified").default(false),
	name: text$1("name"),
	passwordHash: text$1("password_hash").notNull().default(""),
	image: text$1("image"),
	role: integer$1("role").notNull().default(1),
	orgId: integer$1("org_id").references(() => organizations.id, { onDelete: "set null" }),
	quota: bigint("quota", { mode: "number" }).notNull().default(0),
	usedQuota: bigint("used_quota", { mode: "number" }).notNull().default(0),
	group: text$1("group").notNull().default("default"),
	status: integer$1("status").notNull().default(1),
	currency: text$1("currency").notNull().default("USD"),
	billingPreference: text$1("billing_preference").notNull().default("subscription_first"),
	quotaDisplayType: text$1("quota_display_type").notNull().default("USD"),
	githubId: text$1("github_id"),
	twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
	twoFactorSecret: text$1("two_factor_secret"),
	twoFactorPendingSecret: text$1("two_factor_pending_secret"),
	twoFactorBackupCodes: jsonb("two_factor_backup_codes").$type().default([]),
	twoFactorPendingBackupCodes: jsonb("two_factor_pending_backup_codes").$type().default([]),
	lockedUntil: timestamp("locked_until", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
var sessions = pgTable("session", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	token: text$1("token").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	ipAddress: text$1("ip_address"),
	userAgent: text$1("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
var tokens = pgTable("tokens", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	orgId: integer$1("org_id").references(() => organizations.id, { onDelete: "set null" }),
	name: text$1("name").notNull(),
	key: text$1("key").notNull().unique(),
	status: integer$1("status").notNull().default(1),
	remainQuota: bigint("remain_quota", { mode: "number" }).notNull().default(-1),
	usedQuota: bigint("used_quota", { mode: "number" }).notNull().default(0),
	models: jsonb("models").$type(),
	subnet: text$1("subnet"),
	allowIps: text$1("allow_ips"),
	rateLimit: integer$1("rate_limit").notNull().default(0),
	unlimitedQuota: boolean("unlimited_quota").notNull().default(false),
	modelLimitsEnabled: boolean("model_limits_enabled").notNull().default(false),
	tokenGroup: text$1("token_group"),
	crossGroupRetry: boolean("cross_group_retry").notNull().default(false),
	accessedAt: timestamp("accessed_at", { withTimezone: true }),
	expiredAt: timestamp("expired_at", { withTimezone: true }),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
var channels = pgTable("channels", {
	id: serial("id").primaryKey(),
	type: integer$1("type").notNull().default(1),
	name: text$1("name").notNull(),
	baseUrl: text$1("base_url").notNull().default("https://api.openai.com"),
	key: text$1("key").notNull(),
	models: jsonb("models").$type().notNull().default([]),
	modelMapping: jsonb("model_mapping").$type().notNull().default({}),
	weight: integer$1("weight").notNull().default(1),
	priority: integer$1("priority").notNull().default(0),
	groups: jsonb("groups").$type(),
	status: integer$1("status").notNull().default(1),
	statusMessage: text$1("status_message"),
	keyStrategy: integer$1("key_strategy").notNull().default(0),
	keyStatus: jsonb("key_status").$type().notNull().default({}),
	keyConcurrencyLimit: integer$1("key_concurrency_limit").notNull().default(0),
	endpointType: text$1("endpoint_type").notNull().default("auto"),
	priceRatio: decimal("price_ratio", {
		precision: 10,
		scale: 4
	}).default("1.0"),
	testModel: text$1("test_model"),
	openaiOrganization: text$1("openai_organization"),
	balance: decimal("balance", {
		precision: 20,
		scale: 8
	}),
	balanceUpdatedAt: timestamp("balance_updated_at", { withTimezone: true }),
	responseTime: integer$1("response_time"),
	statusCodeMapping: jsonb("status_code_mapping").$type().notNull().default({}),
	autoBan: integer$1("auto_ban").notNull().default(1),
	tag: text$1("tag"),
	setting: jsonb("setting").$type().notNull().default({}),
	paramOverride: jsonb("param_override").$type().notNull().default({}),
	headerOverride: jsonb("header_override").$type().notNull().default({}),
	remark: text$1("remark"),
	channelInfo: jsonb("channel_info").$type().notNull().default({}),
	testErrors: integer$1("test_errors").notNull().default(0),
	testAt: timestamp("test_at", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
var rateLimitRules = pgTable("rate_limit_rules", {
	id: serial("id").primaryKey(),
	name: varchar("name", { length: 100 }).notNull(),
	rpm: integer$1("rpm").default(0),
	rph: integer$1("rph").default(0),
	concurrent: integer$1("concurrent").default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
var packages = pgTable("packages", {
	id: serial("id").primaryKey(),
	name: varchar("name", { length: 100 }).notNull(),
	subtitle: text$1("subtitle"),
	description: text$1("description"),
	price: decimal("price", {
		precision: 10,
		scale: 2
	}).notNull(),
	currency: text$1("currency").notNull().default("USD"),
	durationDays: integer$1("duration_days").notNull().default(30),
	durationUnit: text$1("duration_unit").notNull().default("day"),
	durationValue: integer$1("duration_value").notNull().default(30),
	customSeconds: bigint("custom_seconds", { mode: "number" }).notNull().default(0),
	models: jsonb("models").$type().default([]),
	defaultRateLimitId: integer$1("default_rate_limit_id").references(() => rateLimitRules.id, { onDelete: "set null" }),
	modelRateLimits: jsonb("model_rate_limits").$type().default({}),
	cycleQuota: bigint("cycle_quota", { mode: "number" }).default(0),
	cycleInterval: integer$1("cycle_interval").default(1),
	cycleUnit: text$1("cycle_unit").default("day"),
	totalAmount: bigint("total_amount", { mode: "number" }).notNull().default(0),
	quotaResetPeriod: text$1("quota_reset_period").notNull().default("never"),
	quotaResetCustomSeconds: bigint("quota_reset_custom_seconds", { mode: "number" }).notNull().default(0),
	enabled: boolean("enabled").notNull().default(true),
	isPublic: boolean("is_public").default(true),
	sortOrder: integer$1("sort_order").notNull().default(0),
	stripePriceId: text$1("stripe_price_id"),
	creemProductId: text$1("creem_product_id"),
	waffoPancakeProductId: text$1("waffo_pancake_product_id"),
	maxPurchasePerUser: integer$1("max_purchase_per_user").notNull().default(0),
	upgradeGroup: text$1("upgrade_group"),
	allowedGroups: jsonb("allowed_groups").$type().default([]),
	addedBy: integer$1("added_by").references(() => users.id, { onDelete: "set null" }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("redemptions", {
	id: serial("id").primaryKey(),
	name: text$1("name").notNull(),
	key: text$1("key").notNull().unique(),
	quota: bigint("quota", { mode: "number" }).notNull().default(0),
	count: integer$1("count").notNull().default(1),
	usedCount: integer$1("used_count").notNull().default(0),
	status: integer$1("status").notNull().default(1),
	createdBy: integer$1("created_by").references(() => users.id, { onDelete: "set null" }),
	usedBy: integer$1("used_by").references(() => users.id, { onDelete: "set null" }),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
var logs = pgTable("logs", {
	id: serial("id"),
	userId: integer$1("user_id").notNull(),
	tokenId: integer$1("token_id"),
	channelId: integer$1("channel_id"),
	modelName: text$1("model_name").notNull(),
	quotaCost: bigint("quota_cost", { mode: "number" }).notNull().default(0),
	promptTokens: integer$1("prompt_tokens").notNull().default(0),
	completionTokens: integer$1("completion_tokens").notNull().default(0),
	cachedTokens: integer$1("cached_tokens").notNull().default(0),
	elapsedMs: integer$1("elapsed_ms").notNull().default(0),
	isStream: boolean("is_stream").default(false),
	errorMessage: text$1("error_message"),
	statusCode: integer$1("status_code").notNull().default(200),
	ipAddress: varchar("ip_address", { length: 45 }),
	userAgent: text$1("user_agent"),
	traceId: text$1("trace_id"),
	orgId: integer$1("org_id").references(() => organizations.id, { onDelete: "set null" }),
	externalTaskId: text$1("external_task_id"),
	externalUserId: text$1("external_user_id"),
	externalWorkspaceId: text$1("external_workspace_id"),
	externalFeatureType: text$1("external_feature_type"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("model_metadata", {
	id: serial("id").primaryKey(),
	modelName: text$1("model_name").notNull().unique(),
	type: text$1("type").notNull().default("chat"),
	endpoint: text$1("endpoint"),
	displayName: text$1("display_name"),
	tags: jsonb("tags").$type().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("token_cache", {
	keyHash: text$1("key_hash").primaryKey(),
	tokenData: jsonb("token_data").$type().notNull(),
	userId: integer$1("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	expiredAt: timestamp("expired_at", { withTimezone: true })
});
pgTable("user_quota_cache", {
	userId: integer$1("user_id").primaryKey(),
	quota: bigint("quota", { mode: "number" }).notNull(),
	usedQuota: bigint("used_quota", { mode: "number" }).notNull().default(0),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("options", {
	key: text$1("key").primaryKey(),
	value: text$1("value").notNull().default("")
});
pgTable("vendors", {
	id: serial("id").primaryKey(),
	name: text$1("name").notNull(),
	type: integer$1("type").default(0),
	baseUrl: text$1("base_url").default(""),
	logoUrl: text$1("logo_url").default(""),
	description: text$1("description").default(""),
	config: jsonb("config").$type().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("tasks", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	tokenId: integer$1("token_id").references(() => tokens.id, { onDelete: "set null" }),
	channelId: integer$1("channel_id").references(() => channels.id, { onDelete: "set null" }),
	model: text$1("model").notNull(),
	type: varchar("type", { length: 50 }).notNull(),
	status: varchar("status", { length: 30 }).notNull().default("pending"),
	providerTaskId: text$1("provider_task_id"),
	requestBody: jsonb("request_body").$type().notNull().default({}),
	result: jsonb("result").$type(),
	error: text$1("error"),
	progress: integer$1("progress").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("workflow_templates", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text$1("name").notNull(),
	description: text$1("description"),
	groupName: text$1("group_name").default("default"),
	templateJson: jsonb("template_json").notNull(),
	inputParameters: jsonb("input_parameters").$type().notNull().default([]),
	providerType: integer$1("provider_type").notNull().default(100),
	userId: uuid("user_id"),
	isPublic: boolean("is_public").default(false),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("user_checkins", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	checkinDate: date("checkin_date").notNull(),
	reward: bigint("reward", { mode: "number" }).notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("health_logs", {
	id: serial("id").primaryKey(),
	channelId: integer$1("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
	status: integer$1("status").notNull(),
	latency: integer$1("latency"),
	errorMessage: text$1("error_message"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("daily_stats", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	statDate: date("stat_date").notNull(),
	requestCount: integer$1("request_count").notNull().default(0),
	totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
	totalCost: bigint("total_cost", { mode: "number" }).notNull().default(0),
	successCount: integer$1("success_count").notNull().default(0),
	errorCount: integer$1("error_count").notNull().default(0)
});
pgTable("model_stats", {
	id: serial("id").primaryKey(),
	modelName: text$1("model_name").notNull(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	requestCount: integer$1("request_count").notNull().default(0),
	totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
	totalCost: bigint("total_cost", { mode: "number" }).notNull().default(0),
	avgTokensPerRequest: integer$1("avg_tokens_per_request").notNull().default(0),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow()
});
pgTable("rate_limits", {
	key: text$1("key").primaryKey(),
	count: integer$1("count").notNull().default(0),
	expiredAt: timestamp("expired_at", { withTimezone: true })
});
pgTable("response_cache", {
	hash: text$1("hash").primaryKey(),
	modelName: text$1("model_name").notNull(),
	response: jsonb("response").$type(),
	usage: jsonb("usage").$type(),
	createdBy: integer$1("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	lastReadAt: timestamp("last_read_at", { withTimezone: true }),
	expiredAt: timestamp("expired_at", { withTimezone: true })
});
pgTable("agent_memories", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	tokenId: integer$1("token_id").references(() => tokens.id, { onDelete: "cascade" }),
	orgId: integer$1("org_id").references(() => organizations.id, { onDelete: "cascade" }),
	threadId: text$1("thread_id"),
	scope: text$1("scope").notNull().default("user"),
	kind: text$1("kind").notNull().default("fact"),
	content: text$1("content").notNull(),
	contentHash: text$1("content_hash").notNull(),
	embedding: text$1("embedding"),
	confidence: decimal("confidence", {
		precision: 5,
		scale: 4
	}).notNull().default("1.0000"),
	sourceTraceId: text$1("source_trace_id"),
	metadata: jsonb("metadata").$type().notNull().default({}),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	lastReadAt: timestamp("last_read_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("api_files", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull(),
	tokenId: integer$1("token_id"),
	object: text$1("object").default("file"),
	bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
	filename: text$1("filename").notNull(),
	purpose: text$1("purpose").notNull(),
	status: text$1("status").default("processed"),
	statusDetails: text$1("status_details"),
	content: bytea("content"),
	metadata: jsonb("metadata").$type().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("api_batches", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull(),
	tokenId: integer$1("token_id"),
	endpoint: text$1("endpoint"),
	inputFileId: text$1("input_file_id"),
	completionWindow: text$1("completion_window").default("24h"),
	status: text$1("status").notNull().default("validating"),
	outputFileId: text$1("output_file_id"),
	errorFileId: text$1("error_file_id"),
	requestCounts: jsonb("request_counts").$type().default({
		total: 0,
		completed: 0,
		failed: 0
	}),
	metadata: jsonb("metadata").$type().default({}),
	errors: jsonb("errors").$type(),
	expiredAt: timestamp("expired_at", { withTimezone: true }),
	inProgressAt: timestamp("in_progress_at", { withTimezone: true }),
	finalizingAt: timestamp("finalizing_at", { withTimezone: true }),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	failedAt: timestamp("failed_at", { withTimezone: true }),
	cancellingAt: timestamp("cancelling_at", { withTimezone: true }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("mj_tasks", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull(),
	uuid: text$1("uuid").notNull(),
	action: text$1("action").notNull(),
	prompt: text$1("prompt"),
	status: text$1("status").notNull().default("SUBMITTED"),
	progress: text$1("progress").default("0%"),
	imageUrl: text$1("image_url"),
	failReason: text$1("fail_reason"),
	finishTime: timestamp("finish_time", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
var paymentOrders = pgTable("payment_orders", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull(),
	amount: integer$1("amount").notNull(),
	paymentMethod: text$1("payment_method").notNull(),
	orderType: text$1("order_type").notNull().default("topup"),
	targetType: text$1("target_type"),
	targetId: integer$1("target_id"),
	metadata: jsonb("metadata").$type().notNull().default({}),
	status: integer$1("status").notNull().default(0),
	transactionId: text$1("transaction_id"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
var subscriptionOrders = pgTable("subscription_orders", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	packageId: integer$1("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
	amount: integer$1("amount").notNull().default(0),
	currency: text$1("currency").notNull().default("USD"),
	money: decimal("money", {
		precision: 10,
		scale: 2
	}).notNull().default("0"),
	tradeNo: text$1("trade_no").notNull().unique(),
	paymentMethod: text$1("payment_method").notNull(),
	paymentProvider: text$1("payment_provider").notNull().default(""),
	transactionId: text$1("transaction_id"),
	status: text$1("status").notNull().default("pending"),
	providerPayload: text$1("provider_payload"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("topup_logs", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	paymentOrderId: integer$1("payment_order_id").references(() => paymentOrders.id, { onDelete: "set null" }),
	subscriptionOrderId: integer$1("subscription_order_id").references(() => subscriptionOrders.id, { onDelete: "set null" }),
	action: text$1("action").notNull(),
	paymentMethod: text$1("payment_method"),
	paymentProvider: text$1("payment_provider"),
	amount: bigint("amount", { mode: "number" }).notNull().default(0),
	money: decimal("money", {
		precision: 10,
		scale: 2
	}).notNull().default("0"),
	details: jsonb("details").$type().notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("idempotency_keys", {
	keyHash: text$1("key_hash").primaryKey(),
	userId: integer$1("user_id").notNull(),
	responseCode: integer$1("response_code"),
	responseBody: jsonb("response_body").$type(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
});
var logDetails = pgTable("log_details", {
	logId: integer$1("log_id").primaryKey(),
	logCreatedAt: timestamp("log_created_at", { withTimezone: true }),
	requestBody: text$1("request_body"),
	responseBody: text$1("response_body")
});
pgTable("budget_alerts", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull(),
	username: text$1("username").notNull(),
	quota: bigint("quota", { mode: "number" }).notNull(),
	usedQuota: bigint("used_quota", { mode: "number" }).notNull(),
	usagePercent: decimal("usage_percent", {
		precision: 5,
		scale: 4
	}).notNull(),
	alertLevel: text$1("alert_level").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("audit_logs", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull(),
	username: text$1("username").notNull(),
	action: text$1("action").notNull(),
	resource: text$1("resource").notNull(),
	resourceId: text$1("resource_id"),
	details: jsonb("details").$type(),
	ipAddress: text$1("ip_address"),
	userAgent: text$1("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("user_subscriptions", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	packageId: integer$1("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
	status: integer$1("status").notNull().default(1),
	source: text$1("source").notNull().default("order"),
	startTime: timestamp("start_time", { withTimezone: true }).defaultNow(),
	endTime: timestamp("end_time", { withTimezone: true }).notNull(),
	amountTotal: bigint("amount_total", { mode: "number" }).notNull().default(0),
	amountUsed: bigint("amount_used", { mode: "number" }).notNull().default(0),
	quotaGranted: bigint("quota_granted", { mode: "number" }).default(0),
	quotaUsed: bigint("quota_used", { mode: "number" }).default(0),
	lastResetAt: timestamp("last_reset_at", { withTimezone: true }).defaultNow(),
	nextResetAt: timestamp("next_reset_at", { withTimezone: true }),
	upgradeGroup: text$1("upgrade_group"),
	prevUserGroup: text$1("prev_user_group"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("invite_codes", {
	id: serial("id").primaryKey(),
	code: text$1("code").notNull().unique(),
	maxUses: integer$1("max_uses").notNull().default(1),
	usedCount: integer$1("used_count").notNull().default(0),
	giftQuota: bigint("gift_quota", { mode: "number" }).notNull().default(0),
	status: integer$1("status").notNull().default(1),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	createdBy: integer$1("created_by").references(() => users.id, { onDelete: "set null" }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("announcements", {
	id: serial("id").primaryKey(),
	title: text$1("title").notNull(),
	content: text$1("content").notNull().default(""),
	tag: text$1("tag"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("user_aff", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
	code: text$1("code").notNull().unique(),
	reward: bigint("reward", { mode: "number" }).notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("user_aff_rewards", {
	id: serial("id").primaryKey(),
	referrerId: integer$1("referrer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	refereeId: integer$1("referee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	reward: bigint("reward", { mode: "number" }).notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("oauth_accounts", {
	id: serial("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	provider: text$1("provider").notNull(),
	providerUserId: text$1("provider_user_id").notNull(),
	accessToken: text$1("access_token"),
	refreshToken: text$1("refresh_token"),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("custom_oauth_providers", {
	id: serial("id").primaryKey(),
	name: text$1("name").notNull(),
	issuer: text$1("issuer"),
	discoveryUrl: text$1("discovery_url"),
	clientId: text$1("client_id"),
	clientSecret: text$1("client_secret"),
	authorizationEndpoint: text$1("authorization_endpoint"),
	tokenEndpoint: text$1("token_endpoint"),
	userinfoEndpoint: text$1("userinfo_endpoint"),
	jwksUri: text$1("jwks_uri"),
	scopes: jsonb("scopes").$type().default([]),
	enabled: boolean("enabled").notNull().default(true),
	metadata: jsonb("metadata").$type().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("verification_codes", {
	id: serial("id").primaryKey(),
	type: text$1("type").notNull(),
	target: text$1("target").notNull(),
	code: text$1("code").notNull(),
	userId: integer$1("user_id").references(() => users.id, { onDelete: "cascade" }),
	ipAddress: text$1("ip_address"),
	consumed: boolean("consumed").notNull().default(false),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("assistants", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	tokenId: integer$1("token_id"),
	object: text$1("object").default("assistant"),
	name: text$1("name"),
	description: text$1("description"),
	model: text$1("model").notNull(),
	instructions: text$1("instructions"),
	tools: jsonb("tools").$type().default([]),
	fileIds: jsonb("file_ids").$type().default([]),
	metadata: jsonb("metadata").$type().default({}),
	temperature: decimal("temperature", {
		precision: 5,
		scale: 2
	}),
	topP: decimal("top_p", {
		precision: 5,
		scale: 4
	}),
	status: text$1("status").default("active"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
var threads = pgTable("threads", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	tokenId: integer$1("token_id"),
	object: text$1("object").default("thread"),
	metadata: jsonb("metadata").$type().default({}),
	toolResources: jsonb("tool_resources").$type().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("thread_messages", {
	id: text$1("id").primaryKey(),
	threadId: text$1("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
	userId: integer$1("user_id").notNull(),
	object: text$1("object").default("thread.message"),
	role: text$1("role").notNull().default("user"),
	content: jsonb("content").$type().default([]),
	assistantId: text$1("assistant_id"),
	runId: text$1("run_id"),
	attachments: jsonb("attachments").$type().default([]),
	metadata: jsonb("metadata").$type().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("thread_runs", {
	id: text$1("id").primaryKey(),
	threadId: text$1("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
	assistantId: text$1("assistant_id"),
	userId: integer$1("user_id").notNull(),
	object: text$1("object").default("thread.run"),
	status: text$1("status").notNull().default("queued"),
	model: text$1("model"),
	instructions: text$1("instructions"),
	tools: jsonb("tools").$type().default([]),
	metadata: jsonb("metadata").$type().default({}),
	temperature: decimal("temperature", {
		precision: 5,
		scale: 2
	}),
	topP: decimal("top_p", {
		precision: 5,
		scale: 4
	}),
	maxPromptTokens: integer$1("max_prompt_tokens"),
	maxCompletionTokens: integer$1("max_completion_tokens"),
	truncationStrategy: jsonb("truncation_strategy").$type(),
	toolChoice: jsonb("tool_choice"),
	responseFormat: jsonb("response_format"),
	requiredAction: jsonb("required_action").$type(),
	lastError: jsonb("last_error").$type(),
	usage: jsonb("usage").$type(),
	startedAt: timestamp("started_at", { withTimezone: true }),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
	failedAt: timestamp("failed_at", { withTimezone: true }),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
var vectorStores = pgTable("vector_stores", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	tokenId: integer$1("token_id"),
	object: text$1("object").default("vector_store"),
	name: text$1("name"),
	fileCounts: jsonb("file_counts").$type().default({
		in_progress: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
		total: 0
	}),
	status: text$1("status").default("completed"),
	usageBytes: bigint("usage_bytes", { mode: "number" }).notNull().default(0),
	metadata: jsonb("metadata").$type().default({}),
	expiresAfter: jsonb("expires_after").$type(),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("vector_store_files", {
	id: text$1("id").primaryKey(),
	vectorStoreId: text$1("vector_store_id").notNull().references(() => vectorStores.id, { onDelete: "cascade" }),
	fileId: text$1("file_id"),
	object: text$1("object").default("vector_store.file"),
	status: text$1("status").default("completed"),
	usageBytes: bigint("usage_bytes", { mode: "number" }).notNull().default(0),
	lastError: jsonb("last_error").$type(),
	chunkingStrategy: jsonb("chunking_strategy").$type(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("fine_tuning_jobs", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	tokenId: integer$1("token_id"),
	object: text$1("object").default("fine_tuning.job"),
	model: text$1("model").notNull(),
	trainingFileId: text$1("training_file"),
	validationFileId: text$1("validation_file"),
	hyperparameters: jsonb("hyperparameters").$type().default({}),
	status: text$1("status").notNull().default("validating_files"),
	fineTunedModel: text$1("fine_tuned_model"),
	organizationId: text$1("organization_id"),
	resultFiles: jsonb("result_files").$type().default([]),
	trainedTokens: integer$1("trained_tokens"),
	error: jsonb("error").$type(),
	epochs: integer$1("epochs"),
	suffix: text$1("suffix"),
	integrations: jsonb("integrations").$type().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	finishedAt: timestamp("finished_at", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("login_attempts", {
	id: serial("id").primaryKey(),
	username: text$1("username").notNull(),
	ipAddress: text$1("ip_address"),
	success: boolean("success").notNull().default(false),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("two_factor_login_challenges", {
	id: text$1("id").primaryKey(),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
var teams = pgTable("teams", {
	id: serial("id").primaryKey(),
	orgId: integer$1("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
	name: varchar("name", { length: 120 }).notNull(),
	slug: varchar("slug", { length: 80 }),
	description: text$1("description"),
	leaderId: integer$1("leader_id").references(() => users.id, { onDelete: "set null" }),
	budget: bigint("budget", { mode: "number" }).notNull().default(0),
	usedBudget: bigint("used_budget", { mode: "number" }).notNull().default(0),
	allowedModels: jsonb("allowed_models").$type().notNull().default([]),
	deniedModels: jsonb("denied_models").$type().notNull().default([]),
	status: integer$1("status").notNull().default(1),
	metadata: jsonb("metadata").$type().notNull().default({}),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("projects", {
	id: serial("id").primaryKey(),
	orgId: integer$1("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
	teamId: integer$1("team_id").references(() => teams.id, { onDelete: "set null" }),
	name: varchar("name", { length: 120 }).notNull(),
	slug: varchar("slug", { length: 80 }),
	description: text$1("description"),
	budget: bigint("budget", { mode: "number" }).notNull().default(0),
	usedBudget: bigint("used_budget", { mode: "number" }).notNull().default(0),
	allowedModels: jsonb("allowed_models").$type().notNull().default([]),
	deniedModels: jsonb("denied_models").$type().notNull().default([]),
	status: integer$1("status").notNull().default(1),
	metadata: jsonb("metadata").$type().notNull().default({}),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("team_members", {
	id: serial("id").primaryKey(),
	teamId: integer$1("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
	userId: integer$1("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	role: varchar("role", { length: 30 }).notNull().default("member"),
	joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_gateway_instances", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appId: text$1("app_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	projectId: text$1("project_id"),
	status: varchar("status", { length: 30 }).notNull().default("provisioning"),
	publicBaseUrl: text$1("public_base_url"),
	adminBaseUrl: text$1("admin_base_url"),
	databaseUrlSecretName: text$1("database_url_secret_name"),
	supauthIssuerUrl: text$1("supauth_issuer_url"),
	supauthJwksUrl: text$1("supauth_jwks_url"),
	supauthAudience: text$1("supauth_audience"),
	entitlementsVersion: integer$1("entitlements_version").notNull().default(0),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_identity_policies", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	name: text$1("name").notNull(),
	targetKind: varchar("target_kind", { length: 40 }).notNull().default("org"),
	targetId: text$1("target_id"),
	effect: varchar("effect", { length: 20 }).notNull().default("allow"),
	rules: jsonb("rules").$type().notNull().default({}),
	status: varchar("status", { length: 30 }).notNull().default("active"),
	createdBy: text$1("created_by"),
	updatedBy: text$1("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_budgets", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	subjectKind: varchar("subject_kind", { length: 40 }).notNull().default("org"),
	subjectId: text$1("subject_id"),
	period: varchar("period", { length: 30 }).notNull().default("monthly"),
	limitQuota: bigint("limit_quota", { mode: "number" }).notNull().default(0),
	usedQuota: bigint("used_quota", { mode: "number" }).notNull().default(0),
	alertThresholdPct: integer$1("alert_threshold_pct").notNull().default(80),
	resetAt: timestamp("reset_at", { withTimezone: true }),
	status: varchar("status", { length: 30 }).notNull().default("active"),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdBy: text$1("created_by"),
	updatedBy: text$1("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_audit_events", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	actorType: varchar("actor_type", { length: 40 }).notNull().default("user"),
	actorId: text$1("actor_id"),
	action: text$1("action").notNull(),
	resource: text$1("resource").notNull(),
	resourceId: text$1("resource_id"),
	details: jsonb("details").$type().notNull().default({}),
	ipAddress: text$1("ip_address"),
	userAgent: text$1("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_org_entitlements", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	seatLimit: integer$1("seat_limit").notNull().default(5),
	assignedSeats: integer$1("assigned_seats").notNull().default(0),
	billingMode: varchar("billing_mode", { length: 30 }).notNull().default("prepaid"),
	overageEnabled: boolean("overage_enabled").notNull().default(false),
	overageUnitPriceCents: integer$1("overage_unit_price_cents").notNull().default(0),
	budgetMode: varchar("budget_mode", { length: 30 }).notNull().default("hard_limit"),
	defaultNoTraining: boolean("default_no_training").notNull().default(true),
	dataRetentionDays: integer$1("data_retention_days").notNull().default(30),
	providerComplianceMode: varchar("provider_compliance_mode", { length: 30 }).notNull().default("strict"),
	allowedIpPolicy: text$1("allowed_ip_policy"),
	status: varchar("status", { length: 30 }).notNull().default("active"),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdBy: text$1("created_by"),
	updatedBy: text$1("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_memberships", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	userId: text$1("user_id"),
	email: text$1("email"),
	displayName: text$1("display_name"),
	role: varchar("role", { length: 40 }).notNull().default("developer"),
	scopes: jsonb("scopes").$type().notNull().default([]),
	seatKind: varchar("seat_kind", { length: 30 }).notNull().default("human"),
	seatStatus: varchar("seat_status", { length: 30 }).notNull().default("active"),
	invitedBy: text$1("invited_by"),
	joinedAt: timestamp("joined_at", { withTimezone: true }),
	lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
var enterpriseBillingAccounts = pgTable("enterprise_billing_accounts", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	billingName: text$1("billing_name").notNull(),
	billingEmail: text$1("billing_email"),
	taxId: text$1("tax_id"),
	currency: text$1("currency").notNull().default("USD"),
	paymentTerms: varchar("payment_terms", { length: 40 }).notNull().default("net_30"),
	status: varchar("status", { length: 30 }).notNull().default("active"),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdBy: text$1("created_by"),
	updatedBy: text$1("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
var enterpriseInvoices = pgTable("enterprise_invoices", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	billingAccountId: integer$1("billing_account_id").references(() => enterpriseBillingAccounts.id, { onDelete: "set null" }),
	invoiceNumber: text$1("invoice_number").notNull(),
	periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
	periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
	currency: text$1("currency").notNull().default("USD"),
	subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
	taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
	totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
	status: varchar("status", { length: 30 }).notNull().default("draft"),
	dueAt: timestamp("due_at", { withTimezone: true }),
	issuedAt: timestamp("issued_at", { withTimezone: true }),
	paidAt: timestamp("paid_at", { withTimezone: true }),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_invoice_items", {
	id: serial("id").primaryKey(),
	invoiceId: integer$1("invoice_id").notNull().references(() => enterpriseInvoices.id, { onDelete: "cascade" }),
	itemType: varchar("item_type", { length: 40 }).notNull(),
	description: text$1("description").notNull(),
	quantity: decimal("quantity", {
		precision: 20,
		scale: 4
	}).notNull().default("1"),
	unitAmountCents: bigint("unit_amount_cents", { mode: "number" }).notNull().default(0),
	amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
	sourceType: varchar("source_type", { length: 40 }),
	sourceId: text$1("source_id"),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_metered_usage", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	subjectKind: varchar("subject_kind", { length: 40 }).notNull().default("org"),
	subjectId: text$1("subject_id"),
	metric: varchar("metric", { length: 40 }).notNull().default("quota"),
	quantity: bigint("quantity", { mode: "number" }).notNull().default(0),
	unitAmountCents: integer$1("unit_amount_cents").notNull().default(0),
	amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
	sourceLogId: integer$1("source_log_id"),
	invoiceId: integer$1("invoice_id").references(() => enterpriseInvoices.id, { onDelete: "set null" }),
	occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow(),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
pgTable("enterprise_provider_compliance", {
	id: serial("id").primaryKey(),
	tenantId: text$1("tenant_id").notNull(),
	orgId: text$1("org_id").notNull(),
	appInstanceId: text$1("app_instance_id").notNull(),
	providerKind: varchar("provider_kind", { length: 60 }).notNull(),
	providerId: text$1("provider_id").notNull(),
	displayName: text$1("display_name"),
	noTraining: boolean("no_training").notNull().default(false),
	zeroRetention: boolean("zero_retention").notNull().default(false),
	region: text$1("region"),
	status: varchar("status", { length: 30 }).notNull().default("review"),
	evidenceUrl: text$1("evidence_url"),
	reviewedBy: text$1("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
	metadata: jsonb("metadata").$type().notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
pgTable("deleted_records", {
	id: serial("id").primaryKey(),
	resourceType: varchar("resource_type", { length: 60 }).notNull(),
	resourceId: integer$1("resource_id").notNull(),
	snapshot: jsonb("snapshot").$type().notNull(),
	deletedBy: integer$1("deleted_by").references(() => users.id, { onDelete: "set null" }),
	restoredAt: timestamp("restored_at", { withTimezone: true }),
	restoredBy: integer$1("restored_by").references(() => users.id, { onDelete: "set null" }),
	purgeAt: timestamp("purge_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
//#endregion
//#region ../../packages/db/src/index.ts
var BunSQL = globalThis.Bun?.SQL;
var allowMissingDatabaseUrl = process.env.SKIP_DB_ENV_VALIDATION === "1";
var rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
	if (process.env.NODE_ENV === "production" && !allowMissingDatabaseUrl) throw new Error("Critical: DATABASE_URL is missing in production environment.");
	console.warn("⚠️  DATABASE_URL is missing. Using local development default.");
}
var url = new URL(rawUrl || "postgresql://postgres:postgres@localhost:5432/elygate");
url.searchParams.set("options", "-c synchronous_commit=off");
var finalizedUrl = url.toString();
/**
* Connection pool configuration optimized for PostgreSQL 18.3
* - max: Increased pool size for better concurrency
* - idle_timeout: Clean up idle connections after 30s
* - connect_timeout: Fail fast on connection issues
* - max_lifetime: Refresh connections periodically
* - max_pipeline: Increase pipeline depth for batch operations
*/
var poolConfig = {
	max: parseInt(process.env.DB_POOL_SIZE || "20"),
	idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || "30"),
	connect_timeout: parseInt(process.env.DB_CONNECT_TIMEOUT || "10"),
	max_lifetime: parseInt(process.env.DB_MAX_LIFETIME || "1800"),
	max_pipeline: parseInt(process.env.DB_MAX_PIPELINE || "200")
};
new (BunSQL || class {
	unsafe() {
		throw new Error("Bun.SQL not available");
	}
})(finalizedUrl, poolConfig);
var db = drizzle({ connection: {
	url: finalizedUrl,
	...poolConfig
} });
//#endregion
export { sessions as a, desc as c, gt as d, gte as f, is as g, Column as h, organizations as i, and as l, sql$1 as m, logDetails as n, tokens as o, inArray as p, logs as r, users as s, db as t, eq as u };
