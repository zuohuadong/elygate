import { g as is, h as Column, m as sql } from "./db.js";
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4-273829f+faa42e6373277ee6/node_modules/drizzle-orm/sql/functions/aggregate.js
/**
* Returns the number of values in `expression`.
*
* ## Examples
*
* ```ts
* // Number employees with null values
* db.select({ value: count() }).from(employees)
* // Number of employees where `name` is not null
* db.select({ value: count(employees.name) }).from(employees)
* ```
*
* @see countDistinct to get the number of non-duplicate values in `expression`
*/
function count(expression) {
	return sql`count(${expression || sql.raw("*")})`.mapWith(Number);
}
/**
* Returns the maximum value in `expression`.
*
* ## Examples
*
* ```ts
* // The employee with the highest salary
* db.select({ value: max(employees.salary) }).from(employees)
* ```
*/
function max(expression) {
	return sql`max(${expression})`.mapWith(is(expression, Column) ? expression : String);
}
//#endregion
export { max as n, count as t };
