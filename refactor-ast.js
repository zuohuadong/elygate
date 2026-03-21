const { Project, SyntaxKind } = require('ts-morph');
const fs = require('fs');
const path = require('path');

const project = new Project();
project.addSourceFilesAtPaths("apps/gateway/src/providers/**/*.ts");
project.addSourceFilesAtPaths("apps/gateway/src/services/converters.ts");
project.addSourceFilesAtPaths("apps/gateway/src/services/filter.ts");
project.addSourceFilesAtPaths("apps/gateway/src/services/plugins/search.ts");

for (const sourceFile of project.getSourceFiles()) {
    const classes = sourceFile.getClasses();
    
    // We iterate backwards to avoid position shifting when replacing text
    const classDecls = [...classes].reverse();
    
    for (const classDecl of classDecls) {
        const className = classDecl.getName();
        const implementsDefs = classDecl.getImplements();
        const implementsNames = implementsDefs.map(i => i.getText());
        
        let interfaceName = '';
        if (implementsNames.includes('ProviderHandler')) {
            interfaceName = 'ProviderHandler';
        } else if (implementsNames.includes('FormatConverter')) {
            interfaceName = 'FormatConverter';
        } else if (className === 'ContentFilter' || className === 'WebSearchPlugin') {
            interfaceName = ''; 
        } else {
            console.log("Skipping class: " + className);
            continue;
        }

        const methods = classDecl.getMethods();
        
        const propertiesText = methods.map(m => {
            let text = m.getText();
            // Remove modifiers like public, private, static from the start of the method declaration
            text = text.replace(/^(?:\s*)(?:public\s+|private\s+|static\s+)+/gm, '    ');
            // Remove 'this.' inside the method bodies if needed
            // Wait, this was already confirmed safe or safe to replace with 'className.' for static.
            // For WebSearchPlugin and ContentFilter which had static methods calling other static methods:
            if (className === 'WebSearchPlugin' || className === 'ContentFilter') {
                text = text.replace(new RegExp(`this\\.`, 'g'), `${className}.`);
            } else {
                // For converters, 'this.convertResponse' etc could be replaced by 'this.' which is valid
                // But replacing it with className is even safer.
                text = text.replace(new RegExp(`this\\.`, 'g'), `${className}.`);
            }
            return text;
        }).join(',\n\n');

        
        const typeAnnotation = interfaceName ? `: ${interfaceName}` : '';
        const exportStmt = `export const ${className}${typeAnnotation} = {\n${propertiesText}\n};\n`;
        
        classDecl.replaceWithText(exportStmt);
    }
}

project.saveSync();
console.log("All classes refactored safely using ts-morph!");
