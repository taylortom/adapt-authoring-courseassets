const AbstractApiModule = require('adapt-authoring-api');
const path = require('path');
/**
* Module which handles courseassets
* preserves legacy courseassets routes
* Uses events to automatically insert, update and delete courseassets
* @extends {AbstractApiModule}
*/
class CourseAssetsModule extends AbstractApiModule {
  /** @override */
  async setValues() {
    const server = await this.app.waitForModule('server');
    /** @ignore */ this.root = 'courseassets';
    /** @ignore */ this.schemaName = 'courseasset';
    /** @ignore */ this.collectionName = 'courseassets';
    /** @ignore */ this.router = server.api.createChildRouter('courseassets');
    this.useDefaultRouteConfig();
  }
  /**
  * Initialise the module
  * @return {Promise}
  */
  async init() {
    /**
    * Store of all modules registered to use this plugin
    * @type {Array<AbstractModule>}
    */
    await super.init();
    this.registeredModules = [];

    const [assets, content, jsonschema] = await this.app.waitForModule('assets', 'content', 'jsonschema');
    this.assets = assets;
    this.content = content;
    this.jsonschema = jsonschema;

    const eventHandler = h => data => h(data).then().catch(e => this.log('error', e));

    this.app.onReady().then(async () => {
      this.content.on('insert', eventHandler(this.insertContent));
      this.content.on('delete', eventHandler(this.deleteContent));
      this.content.on('update', eventHandler(this.updateContent));
      this.content.on('replace', eventHandler(this.updateContent));
    });

    this.setReady();
  }
  /** @override */
  async insert(data, options, mongoOptions) {

    if (typeof data !== 'object') throw new Error(this.app.lang.t('error.insertError'));
    if (!data._courseId || !data._contentId || !data._assetId) throw new Error(this.app.lang.t('error.dataFormat'));

    try {
      const [existingRecord] = await this.find(data);
      if (!existingRecord) {
        return await super.insert(data, options, mongoOptions);
      }
      return await this.updateAssetCount('insert', existingRecord);
    } catch(e) {
      throw new Error(`Error creating courseasset, '${e.message}'`);
    }
  }
  /** @override */
  async delete(data, options, mongoOptions) {
    if (typeof data !== 'object') throw new Error(this.app.lang.t('error.deleteError'));

    try {
      const existingRecord = await this.find(data);
      if (!existingRecord || existingRecord.length === 0) throw new Error(this.app.lang.t('error.deleteMissing'));

      if (existingRecord[0].assetCount === 1) {
        const courseAssetId = existingRecord[0]._id.toString();
        return await super.delete({ _id: courseAssetId });
      }
      return await this.updateAssetCount('delete', existingRecord[0]);

    } catch(e) {
      throw new Error(`Error deleting courseasset, '${e.message}'`);
    }
  }
  /**
  * Search data object for asset types and retrieve records from the DB
  * @param {Object} data
  */
   async extractAssets(data) {
    if (typeof data !== 'object' || !data.hasOwnProperty('_type')) return;
    // internal function to be called recursively
    const _extractAssetsRecursive = (schema, data, assets = new Set()) => {
      Object.entries(schema).forEach(([key,val]) => {
        if(val.properties) {
          _extractAssetsRecursive(val.properties, data[key], assets);
        } else if(val?._backboneForms?.type === "Asset") {
          assets.add(data[key].toString());
        }
        return assets;
      }, []);
      return assets;
    };
    const { properties } = await this.jsonschema.getSchema(await this.content.getContentSchemaName(data));
    const _ids = Array.from(_extractAssetsRecursive(properties, data));
    return Promise.all(_ids.map(_id => this.assets.find({ _id })));
  }
  /**
  * Handler for reference count on courseasset record
  * @param {String} action
  * @param {String} data
  */
  async updateAssetCount(action, data) {
    const query = { _id: data._id };
    const existingRecord = await this.find(query);

    if (!existingRecord || existingRecord.length == 0) return;

    if(action === 'insert') {
      return this.update(query, { assetCount: existingRecord[0].assetCount+1 });
    } else if(action === 'delete') {
      if (newCount <= 0) return this.delete(query);
      return this.update(query, { assetCount: existingRecord[0].assetCount-1 });
    }
  }
  /**
   * Handler for inserted content event
   * @param {object} results
   */
  async insertContent(results) {

    if (typeof results != 'object') return;

    results = Array.isArray(results) ? results : [results];

    results.forEach(async r => {
      if (!r._courseId || !r._id) {
        return this.log('error', this.app.lang.t('error.dataFormat'));
      }
      const assets = await this.extractAssets(r);
  
      if (!assets || assets.length === 0) return;

      await Promise.allSettled(assets.map(async a => {
        try {
          return this.insert({ 
            _courseId: r._courseId.toString(), 
            _contentId: r._id.toString(), 
            _assetId: a._id.toString()
          });
        } catch(e) {
          this.log('error', e);
        }
      }));
    });
  }
  /**
   * Handler for deleted content event
   * @param {object} results
   */
  async deleteContent(results) {

    const deletedContent = (Array.isArray(results)) ? results[0] : results;
    if (typeof deletedContent != 'object') return;
    if (!deletedContent._courseId || !deletedContent._id) throw new Error(this.app.lang.t('error.dataFormat'));

    if (deletedContent._type === 'course') {
      return await super.delete({ _courseId: deletedContent._courseId });
    }
    const assets = await this.extractAssets(deletedContent);

    if (!assets || assets.length === 0) return;

    await Promise.all(assets.map(async a => {
      return this.delete({ 
        _courseId: deletedContent._courseId.toString(), 
        _contentId: deletedContent_contentId.toString(), 
        _assetId: a._id.toString()
      });
    }));
  }
  /**
   * Handler for patch and put content events
   * @param {object} results
   */
  async updateContent(originalDoc, results) {

    if (typeof results != 'object' || typeof originalDoc != 'object') return;

    try {
      await this.deleteContent(originalDoc);
      await this.insertContent(results);
    } catch(e) {
      throw new Error(`Error creating courseasset, '${e.message}'`);
    }
  }
}

module.exports = CourseAssetsModule;
