const fs = require('fs');
const path = require('path');

function replaceNewInstantiations(filePath) {
    if (!fs.existsSync(filePath)) return;
    let src = fs.readFileSync(filePath, 'utf8');
    
    // Replace `new XxxApiHandler()` with `XxxApiHandler`
    src = src.replace(/new (\w+Handler(?:s)?)\(\)/g, '$1');
    
    // Replace `new XxxConverter()` with `XxxConverter`
    src = src.replace(/new (\w+Converter)\(\)/g, '$1');
    
    // Also `new ContentFilter()` or `new WebSearchPlugin()` if any exist
    src = src.replace(/new (ContentFilter|WebSearchPlugin)\(\)/g, '$1');

    fs.writeFileSync(filePath, src);
    console.log(`Patched instantiations in ${filePath}`);
}

replaceNewInstantiations('apps/gateway/src/providers/index.ts');
replaceNewInstantiations('apps/gateway/src/routes/mj.ts');
replaceNewInstantiations('apps/gateway/src/services/converters.ts');
replaceNewInstantiations('apps/gateway/tests/providers.test.ts');
replaceNewInstantiations('apps/gateway/tests/unified_converters.test.ts');
// In case search.ts or filter.ts has instantiation:
replaceNewInstantiations('apps/gateway/src/services/filter.ts');
replaceNewInstantiations('apps/gateway/src/services/plugins/search.ts');

