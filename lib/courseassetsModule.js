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

    const assets = await this.app.waitForModule('assets');
    this.assets = assets;

    this.app.onReady().then(async () => {
      const content = await this.app.waitForModule('content');
      content.on('insert', this.insertContent.bind(this));
      content.on('delete', this.deleteContent.bind(this));
      content.on('update', this.updateContent.bind(this));
      content.on('replace', this.updateContent.bind(this));
    });

    this.setReady();
  }

  /** @override */
  async insert(data, options, mongoOptions) {

    if (typeof data !== 'object') throw new Error(this.app.lang.t('error.insertError'));
    if (!data._courseId || !data._contentId || !data._assetId) throw new Error(this.app.lang.t('error.dataFormat'));

    const assetData = {
      _courseId: data._courseId,
      _contentId: data._contentId,
      _assetId: data._assetId
    }

    try {
      const existingRecord = await this.find(assetData);

      if (!existingRecord || existingRecord.length === 0) {
        return await super.insert(assetData, options, mongoOptions);
      }

      return await this.updateAssetCount('insert', existingRecord[0]);
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
      const _id = r._id;
      const _courseId = r._id || r._type === 'course' && _id;
      if (!_courseId || !_id) {
        this.log('error', this.app.lang.t('error.dataFormat'));
        console.log(r);
      }
      const fileArray = await this.jsonAssets(r);
  
      if (!fileArray || fileArray.length === 0) {
        return;
      }
      const results = await Promise.allSettled(fileArray.map(async f => {
        const [asset] = await this.assets.find({ path: f });
        if (!asset) throw new Error(this.app.lang.t('error.findAssetError'));
        return this.insert({ _courseId, _contentId: r._contentId, _assetId: asset._id });
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

    const courseId = deletedContent._courseId.toString();
    const contentId = deletedContent._id.toString();

    if (deletedContent._type === 'course') {
      return await super.delete({ _courseId: courseId });
    }

    const fileArray = await this.jsonAssets(deletedContent);

    if (!fileArray || fileArray.length === 0) return;

    const findAsset = async (assetName) => {

      await this.assets.find({ path: assetName })
        .then((assetRecords) => {
          if (!assetRecords || assetRecords.length == 0) throw new Error(this.app.lang.t('error.findAssetError'));
          const assetData = {
            _courseId: courseId,
            _contentId: contentId,
            _assetId: assetRecords[0]._id.toString()
          };

          return this.delete(assetData);
        })
        .catch((e) => {
          return e;
        });
    };

    const finalCourseAssets = fileArray.reduce((promiseChain, assetItem) =>
      promiseChain.then(() => findAsset(assetItem)), Promise.resolve());

    return finalCourseAssets;

  }

  /**
   * Handler for patch and put content events
   * @param {object} results
   */
  async updateContent(originalDoc, results) {

    if (typeof results != 'object' || typeof originalDoc != 'object') return;

    this.deleteContent(originalDoc).then(res => {
      return this.insertContent(results);
    })
    .catch(e => {
      throw new Error(`Error creating courseasset, '${e.message}'`);
    })
  }


  /**
  * Search data object for asset types
  * @param {Object} data
  */
  async jsonAssets(data) {
    // TODO deal with asset types using schema:  const schema = await this.getContentSchema(data); OR use use recursive find
    if (typeof data !== 'object' || !data.hasOwnProperty('_type')) return;

    const dataString = JSON.stringify(data);
    let courseassets = dataString.match(/(course\/)((\w)*\/)*(\w)*.[a-zA-Z0-9]+/gi);

    if (!courseassets || courseassets.length === 0) return;

    const matchingCourseAssets = courseassets
      .map(fullPath => {
        let fileName = path.basename(fullPath);
        return fileName;
      })
      .filter(file => file && file.length > 0);

    return matchingCourseAssets;
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
