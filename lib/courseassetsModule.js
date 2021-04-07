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

    this.app.onReady().then(async () => {
      this.content.on('insert', this.insertContent.bind(this));
      this.content.on('delete', this.deleteContent.bind(this));
      this.content.on('update', this.updateContent.bind(this));
      this.content.on('replace', this.updateContent.bind(this));
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
   * Handler for inserted content event
   * @param {object} results
   */
  async insertContent(results) {

    if (typeof results != 'object') return;

    results = Array.isArray(results) ? results : [results];

    results.forEach(async r => {
      if (!r._courseId || !r._id) {
        this.log('error', this.app.lang.t('error.dataFormat'));
      }
      const fileArray = await this.jsonAssets(r);
  
      if (!fileArray || fileArray.length === 0) {
        return;
      }
      const results = await Promise.allSettled(fileArray.map(async f => {
        const [asset] = await this.assets.find({ path: f });
        if (!asset) throw new Error(this.app.lang.t('error.findAssetError'));
        return this.insert({ 
          _courseId: r._courseId.toString(), 
          _contentId: r._id.toString(), 
          _assetId: asset._id.toString()
        });
      }));
      results.forEach(r => r.status === 'rejected' && this.log('error', r.reason));
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

    const _courseId = deletedContent._courseId;
    const _contentId = deletedContent._id;

    if (deletedContent._type === 'course') {
      return await super.delete({ _courseId });
    }

    const fileArray = await this.jsonAssets(deletedContent);

    if (!fileArray || fileArray.length === 0) return;

    const findAsset = async (assetName) => {
      const [asset] = await this.assets.find({ path: assetName });
      if (!asset) {
        throw new Error(this.app.lang.t('error.findAssetError'));
      }
      return this.delete({ 
        _courseId: _courseId.toString(), 
        _contentId: _contentId.toString(), 
        _assetId: asset._id.toString()
      });
    };

    return Promise.all(fileArray.map(findAsset));
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


  /**
  * Search data object for asset types
  * @param {Object} data
  */
  async jsonAssets(data) {
    if (typeof data !== 'object' || !data.hasOwnProperty('_type')) return;

    const dataString = JSON.stringify(data);
    let courseassets = dataString.match(/(course\/)((\w)*\/)*(\w)*.[a-zA-Z0-9]+/gi);

    if (!courseassets || courseassets.length === 0) return;

    return courseassets.reduce((memo,c) => {
      const file = path.basename(c);
      if(file && file.length) memo.push(file);
      return memo;
    }, []);
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
    let newCount = existingRecord[0].assetCount;

    switch(action) {
      case 'insert':
        newCount++;
        return await this.update(query, { assetCount: newCount });
      case 'delete':
        newCount--;
        if (newCount <= 0) return this.delete(query);
        return await this.update(query, { assetCount: newCount });
    }
  }
}

module.exports = CourseAssetsModule;
