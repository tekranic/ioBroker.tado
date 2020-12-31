'use strict';

/*
* Created with @iobroker/create-adapter v1.16.0
*/

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
const EXPIRATION_WINDOW_IN_SECONDS = 300;

const tado_auth_url = 'https://auth.tado.com';
const tado_url = 'https://my.tado.com';
const tado_config = {
	client: {
		id: 'tado-web-app',
		secret: 'wZaRN7rpjn3FoNyF5IFuxg9uMzYJcvOoQ8QWiIqS3hfk6gLhVlG57j5YNoZL2Rtc',
	},
	auth: {
		tokenHost: tado_auth_url,
	}
};

const oauth2 = require('simple-oauth2').create(tado_config);
const state_attr = require(__dirname + '/lib/state_attr.js');
const axios = require('axios');
let polling; // Polling timer
let pooltimer = [];
const counter = []; // counter timer

// const fs = require('fs');

class Tado extends utils.Adapter {

	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'tado',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this._accessToken = null;
		this.getMe_data = null;
		this.Home_data =  null;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {

		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);
		await this.DoConnect();

	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.resetTimer();
			this.log.info('cleaned everything up...');
			callback();
		} catch (e) {
			callback();
		}
	}

	async resetTimer() {
		const states = await this.getStatesAsync('*.Rooms.*.link');
		for (const idS in states) {
			let deviceId = idS.split('.');
			let pooltimerid = deviceId[2] + deviceId[4];
			this.log.debug(`Check if timer ${pooltimerid} to be cleared.`);
			if (pooltimer[pooltimerid]) {
				clearTimeout(pooltimer[pooltimerid]);
				pooltimer[pooltimerid] = null;
				this.log.debug(`Timer ${pooltimerid} cleared.`);
			}
		}
		if (polling) {
			clearTimeout(polling);
			polling = null;
			this.log.debug(`Polling-Timer cleared.`);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (state) {
			// The state was changed
			if (state.ack === false) {

				try {

					// const deviceId = id.split('.');
					const deviceId = id.split('.');

					let set_temp = 0;
					let set_mode = '';
					let set_power = '';
					let set_durationInSeconds = 0;

					const temperature = await this.getStateAsync(deviceId[2] + '.Rooms.' + deviceId[4] + '.setting.temperature');
					const mode = await this.getStateAsync(deviceId[2] + '.Rooms.' + deviceId[4] + '.overlay.termination.typeSkillBasedApp');
					const power = await this.getStateAsync(deviceId[2] + '.Rooms.' + deviceId[4] + '.setting.power');
					const durationInSeconds = await this.getStateAsync(deviceId[2] + '.Rooms.' + deviceId[4] + '.overlay.termination.durationInSeconds');

					if (durationInSeconds == null || durationInSeconds == undefined || durationInSeconds.val == null) {
						set_durationInSeconds = 1800;
					} else {
						set_durationInSeconds = parseInt(durationInSeconds.val);
					}
					this.log.debug('DurationInSeconds set : ' + set_durationInSeconds);


					if (temperature !== null && temperature !== undefined) {
						set_temp = parseFloat(temperature.val);
					} else {
						set_temp = 20;
					}
					this.log.debug('Room Temperature set : ' + set_temp);

					if (mode == null || mode == undefined || mode.val == null) {
						set_mode = 'NO_OVERLAY';
					} else {
						if (mode.val != '') {
							set_mode = mode.val.toString().toUpperCase();
						} else {
							set_mode = 'NEXT_TIME_BLOCK';
						}
					}
					this.log.debug('Room mode set : ' + set_mode);

					set_power = power.val.toString().toUpperCase();
					this.log.debug('Room power set : ' + set_power);

					for (const x in deviceId){
						this.log.debug('Device id channel : ' + deviceId[x]);

						switch (deviceId[x]) {

							case ('clearZoneOverlay'):
								this.log.info('Overlay cleared for room : ' + deviceId[4] + ' in home : ' + deviceId[2]);
								await this.clearZoneOverlay(deviceId[2],deviceId[4]);
								//this.DoConnect();
								break;

							case ('temperature'):
								if (set_mode == 'NO_OVERLAY') { set_mode = 'NEXT_TIME_BLOCK' }
								this.log.info('Temperature changed for room : ' + deviceId[4] + ' in home : ' + deviceId[2] + ' to API with : ' + set_temp);
								await this.setZoneOverlay(deviceId[2], deviceId[4],set_power,set_temp,set_mode,set_durationInSeconds);
								//this.DoConnect();
								break;

							case ('durationInSeconds'):
								set_mode = 'TIMER';
								this.log.info('DurationInSecond changed for room : ' + deviceId[4] + ' in home : ' + deviceId[2] + ' to API with : ' + set_durationInSeconds);
								this.setStateAsync(deviceId[2] + '.Rooms.' + deviceId[4] + '.overlay.termination.typeSkillBasedApp',set_mode,true);
								await this.setZoneOverlay(deviceId[2], deviceId[4],set_power,set_temp,set_mode,set_durationInSeconds);
								//this.DoConnect();
								break;

							case ('typeSkillBasedApp'):
								if (set_mode == 'NO_OVERLAY') { break }
								this.log.info('TypeSkillBasedApp changed for room : ' + deviceId[4] + ' in home : ' + deviceId[2] + ' to API with : ' + set_mode);
								await this.setZoneOverlay(deviceId[2], deviceId[4],set_power,set_temp,set_mode,set_durationInSeconds);
								//this.DoConnect();
								if (set_mode == 'MANUAL') {
									this.setStateAsync(deviceId[2] + '.Rooms.' + deviceId[4] + '.overlay.termination.expiry',null,true);
									this.setStateAsync(deviceId[2] + '.Rooms.' + deviceId[4] + '.overlay.termination.durationInSeconds',null,true);
									this.setStateAsync(deviceId[2] + '.Rooms.' + deviceId[4] + '.overlay.termination.remainingTimeInSeconds',null,true);
								}
								break;

							case ('power'):
								if(set_mode  == 'NO_OVERLAY') {
									if (state.val.toUpperCase() == 'ON') {
										this.log.info('Overlay cleared for room : ' + deviceId[4] + ' in home : ' + deviceId[2]);
										await this.clearZoneOverlay(deviceId[2],deviceId[4]);
									}
									else {
										set_mode = 'MANUAL';
										this.log.info('Power changed for room : ' + deviceId[4] + ' in home : ' + deviceId[2] + ' to API with : ' + state.val + ' and Temperature : ' + set_temp + ' and mode : ' + set_mode);
										await this.setZoneOverlay(deviceId[2], deviceId[4],set_power,set_temp,set_mode,set_durationInSeconds);
									}
								} else {
									this.log.info('Power changed for room : ' + deviceId[4] + ' in home : ' + deviceId[2] + ' to API with : ' + state.val + ' and Temperature : ' + set_temp + ' and mode : ' + set_mode);
									await this.setZoneOverlay(deviceId[2], deviceId[4],set_power,set_temp,set_mode,set_durationInSeconds);
								}
								//this.DoConnect();
								break;

							default:

						}

					}

					this.log.debug('State change detected from different source then adapter');
					this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

				} catch (error) {
					this.log.error('Issue at state  change : ' + error);
				}

			}  else {
				this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

			}

		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	async DoConnect(){
		// this.log.info('Username : ' + user + ' Password : ' + pass);

		const user = this.config.Username;
		let pass = this.config.Password;

		// Check if credentials are not empty and decrypt stored password
		if (user !== '' && pass !== ''){
			this.getForeignObject('system.config', (err, obj) => {
				if (obj && obj.native && obj.native.secret) {
				//noinspection JSUnresolvedVariable
					pass = this.decrypt(obj.native.secret, pass);
				} else {
				//noinspection JSUnresolvedVariable
					pass = this.decrypt('Zgfr56gFe87jJOM', pass);
				}

				try {
					this.DoData_Refresh(user,pass);
				} catch (error) {
					this.log.error(error);
				}
			});

		} else {
			this.log.error('*** Adapter deactivated, credentials missing in Adaptper Settings !!!  ***');
			this.setForeignState('system.adapter.' + this.namespace + '.alive', false);
		}

	}

	async DoData_Refresh(user,pass){

		const intervall_time = (this.config.intervall * 1000);

		// Get login token
		try {

			await this.login(user,pass);

			const conn_state = await this.getStateAsync('info.connection');
			if (conn_state === undefined || conn_state === null) {
				return;
			}  else {

				if (conn_state.val === false) {

					this.log.info('Connected to Tado cloud, initialyzing ... ');

				}

			}

			// Get Basic data needed for all other querys and store to global variable
			if(this.getMe_data === null){
				this.getMe_data = await this.getMe();
			}
			this.log.debug('GetMe result : ' + JSON.stringify(this.getMe_data));

			for (const i in this.getMe_data.homes) {
				this.DoWriteJsonRespons(this.getMe_data.homes[i].id,'Stage_01_GetMe_Data', this.getMe_data);
				// create device channel for each Home found in getMe
				await this.setObjectNotExistsAsync(this.getMe_data.homes[i].id.toString(), {
					type: 'device',
					common: {
						name: this.getMe_data.homes[i].name,
					},
					native: {},
				});

				// Write basic data to home specific info channel states
				await this.DoHome(this.getMe_data.homes[i].id);
				await this.DoDevices(this.getMe_data.homes[i].id);
				await this.DoWeather(this.getMe_data.homes[i].id);
				await this.DoInstallations(this.getMe_data.homes[i].id);

				// this.getInstallations(this.getMe_data.homes[i].id);
				// await this.DoUsers(this.getMe_data.homes[i].id) 	// User information equal to Weather, ignoring function but keep for history/feature functionality
				try {
					await this.DoStates(this.getMe_data.homes[i].id);
				} catch (error) {
					//  no info
				}

				this.log.silly('Get all mobile devices');
				try {
					await this.DoMobileDevices(this.getMe_data.homes[i].id);
				} catch (error) {
					this.log.silly('Issue in Get all mobile devices' + error);
				}

				this.log.silly('Get all rooms');
				try {

					await this.DoZones(this.getMe_data.homes[i].id);
				} catch (error) {
					this.log.error('Issue in Get all rooms ' + error);
				}

			}


			if (conn_state === undefined || conn_state === null) {
				return;
			}  else {

				if (conn_state.val === false) {

					this.log.info('Initialisation finished,  connected to Tado Cloud service refreshing every : ' + this.config.intervall + ' seconds');
					this.setState('info.connection', true, true);

				}

			}

			// Clear running timer
			(function () {if (polling) {clearTimeout(polling); polling = null;}})();
			// timer
			polling = setTimeout( () => {
				this.DoConnect();
			}, intervall_time);

		} catch (error) {

			this.log.error(`Error in data refresh : ${error}`);
			this.log.error('Disconnected from Tado cloud service ..., retry in 30 seconds ! ');
			this.setState('info.connection', false, true);
			// retry connection
			polling = setTimeout( () => {
				this.DoConnect();
			}, 30000);
		}

	}

	// Function to decrypt passwords
	decrypt(key, value) {
		let result = '';
		for (let i = 0; i < value.length; ++i) {
			result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
		}
		this.log.debug('client_secret decrypt ready');
		return result;
	}

	_refreshToken() {
		const { token } = this._accessToken;
		const expirationTimeInSeconds = token.expires_at.getTime() / 1000;
		const expirationWindowStart = expirationTimeInSeconds - EXPIRATION_WINDOW_IN_SECONDS;

		// If the start of the window has passed, refresh the token
		const nowInSeconds = (new Date()).getTime() / 1000;
		const shouldRefresh = nowInSeconds >= expirationWindowStart;

		return new Promise((resolve, reject) => {
			if (shouldRefresh) {
				this._accessToken.refresh()
					.then(result => {
						this._accessToken = result;
						resolve(this._accessToken);
					})
					.catch(error => {
						reject(error);
					});
			} else {
				resolve(this._accessToken);
			}
		});
	}

	login(username, password) {
		return new Promise((resolve, reject) => {
			const credentials = {
				scope: 'home.user',
				username: username,
				password: password
			};
			oauth2.ownerPassword.getToken(credentials)
				.then(result => {
					this._accessToken = oauth2.accessToken.create(result);
					// const token = oauth2.accessToken.create(result);
					// JSON.stringify(result);
					// JSON.stringify(this._accessToken);
					resolve(this._accessToken);
				})
				.catch(error => {
					reject(error);
				});
		});
	}

	apiCall(url, method='get', data={}) {
		return new Promise((resolve, reject) => {
			if (this._accessToken) {
				this._refreshToken().then(() => {
					axios({
						url: tado_url + url,
						method: method,
						data: data,
						headers: {
							Authorization: 'Bearer ' + this._accessToken.token.access_token
						}
					}).then(response => {
						resolve(response.data);
					}).catch(error => {
						reject(error);
					});
				});
			} else {
				reject(new Error('Not yet logged in'));
			}
		});
	}

	getMe() {
		return this.apiCall('/api/v2/me');
	}

	// Read account information and all home related data
	getHome(home_id) {
		return this.apiCall(`/api/v2/homes/${home_id}`);
	}

	// Get weather information for home location
	getWeather(home_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/weather`);
	}

	// Function disabled, no data in API ?
	// getDevices(home_id) {
	// 	this.log.info('getDevices called')
	// 	return this.apiCall(`/api/v2/homes/${home_id}/devices`);
	// }

	// Function disabled, no data in API ?
	getInstallations(home_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/installations`);
	}

	// User information equal to Weather, ignoring function but keep for history/feature functionality
	getUsers(home_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/users`);
	}

	// Function disabled, no data in API ?
	getState_info(home_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/state`);
	}

	getMobileDevices(home_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/mobileDevices`);
	}

	getMobileDevice(home_id, device_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/mobileDevices/${device_id}`);
	}

	getMobileDeviceSettings(home_id, device_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/mobileDevices/${device_id}/settings`);
	}

	getZones(home_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/zones`);
	}

	// Coding break point of functionality

	getZoneState(home_id, zone_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/zones/${zone_id}/state`);
	}

	getAwayConfiguration(home_id, zone_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/zones/${zone_id}/awayConfiguration`);
	}

	clearZoneOverlay(home_id, zone_id) {
		let response = this.apiCall(`/api/v2/homes/${home_id}/zones/${zone_id}/overlay`, 'delete');
		this.DoConnect();
		return response;
	}
	
	setZoneOverlay(home_id, zone_id, power, temperature, typeSkillBasedApp, durationInSeconds) {
		const config = {
			setting: {
				type: 'HEATING',
			},
			termination: {
			}
		};

		if (power.toLowerCase() == 'on') {
			config.setting.power = 'ON';

			if (temperature) {
				config.setting.temperature = {};
				config.setting.temperature.celsius = temperature;
			}
		} else {
			config.setting.power = 'OFF';
		}

		config.termination.typeSkillBasedApp = typeSkillBasedApp;

		if (typeSkillBasedApp != 'TIMER') {
			config.termination.durationInSeconds = null;
		}
		else {
			config.termination.durationInSeconds = durationInSeconds;
		}

		this.log.debug('Send API ZoneOverlay API call Home : ' + home_id + ' zone : ' + zone_id + ' config : ' + JSON.stringify(config));
		return this.poolApiCall(home_id,zone_id,config);
	}
	
	/**
	 * @param {string} home_id
	 * @param {string} zone_id
	 * @param {object} config
	 */
	poolApiCall(home_id, zone_id, config) {
		let pooltimerid = home_id + zone_id;
		(function () { if (pooltimer[pooltimerid]) { clearTimeout(pooltimer[pooltimerid]); pooltimer[pooltimerid] = null; } })();
		let that = this;
		return new Promise(function (resolve, reject) {
			pooltimer[pooltimerid] = setTimeout(async () => {
				that.log.debug(`Timeout set for timer '${pooltimerid}' with 750ms`);
				let apiResponse = await that.apiCall(`/api/v2/homes/${home_id}/zones/${zone_id}/overlay`, 'put', config);
				that.log.info(`API called with  ${JSON.stringify(config)}`);
				that.DoConnect();
				that.log.debug('Data refreshed (DoConnect()) called');
				resolve(apiResponse);
			}, 750)
		});
	}

	getZoneCapabilities(home_id, zone_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/zones/${zone_id}/capabilities`);
	}

	// Unclear purpose, ignore for now
	getZoneOverlay(home_id, zone_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/zones/${zone_id}/overlay`);
	}

	getTimeTables(home_id, zone_id) {
		return this.apiCall(`/api/v2/homes/${home_id}/zones/${zone_id}/schedule/activeTimetable`);
	}

	async DoHome(HomeId){
		// Get additional basic data for all homes
		if (this.Home_data  === null){
			this.Home_data = await this.getHome(HomeId);
		}
		this.log.debug('Home_data Result : ' + JSON.stringify(this.Home_data));

		this.DoWriteJsonRespons(HomeId,'Stage_02_HomeData', this.Home_data);
		this.TraverseJson(this.Home_data, `TEST.${HomeId}.Home`);
	}

	async DoWeather(HomeId){
		const weather_data = await this.getWeather(HomeId);
		this.log.debug('Weather_data Result : ' + JSON.stringify(weather_data));

		this.DoWriteJsonRespons(HomeId,'Stage_04_Weather', weather_data);
		this.TraverseJson(weather_data, `TEST.${HomeId}.Weather`);
	}

	async DoDevices(HomeId){
		const Devices_data = await this.getDevices(HomeId);
		this.log.debug('Users_data Result : ' + JSON.stringify(Devices_data));
		this.DoWriteJsonRespons(HomeId,'Stage_03_Devices', Devices_data);
	}

	async DoInstallations(HomeId){
		const Installations_data = await this.getInstallations(HomeId);
		this.log.debug('Installations_data Result : ' + JSON.stringify(Installations_data));
		this.DoWriteJsonRespons(HomeId,'Stage_05_Installations', Installations_data);
	}

	// Function disabled, no data in API ?
	async DoStates(HomeId){
		this.States_data = await this.getState_info(HomeId);
		this.log.debug('States_data Result : ' + JSON.stringify(this.States_data));
		this.DoWriteJsonRespons(HomeId,'Stage_14_StatesData', this.States_data);
	}

	async DoMobileDevices(HomeId){
		this.MobileDevices_data = await this.getMobileDevices(HomeId);
		this.log.debug('MobileDevices_data Result : ' + JSON.stringify(this.MobileDevices_data));
		
		this.DoWriteJsonRespons(HomeId,'Stage_06_MobileDevicesData', this.MobileDevices_data);
		this.TraverseJson(this.MobileDevices_data, `TEST.${HomeId}.MobileDevices`);
	}

	async DoMobileDeviceSettings(HomeId,DeviceId){
		const MobileDeviceSettings_data = await this.getMobileDeviceSettings(HomeId,DeviceId);
		this.log.debug('MobileDeviceSettings_Data Result : ' + JSON.stringify(MobileDeviceSettings_data));

		this.DoWriteJsonRespons(HomeId,'Stage_07_MobileDevicesSettings_'  + DeviceId, MobileDeviceSettings_data);
		this.TraverseJson(MobileDeviceSettings_data, `TEST.${HomeId}.MobileDevices.setting`);
	}

	async DoZones(HomeId){
		this.Zones_data = await this.getZones(HomeId);
		this.log.debug('Zones_data Result : ' + JSON.stringify(this.Zones_data));
		this.DoWriteJsonRespons(HomeId,'Stage_08_ZonesData', this.Zones_data);

		let current_parent = `TEST.${HomeId}.Rooms`;

		this.TraverseJson(this.Zones_data, current_parent);

		for (const i in  this.Zones_data ) {
			let basic_tree = this.Zones_data [i].id;
			await this.DoZoneStates(HomeId, this.Zones_data [i].id, basic_tree);
			await this.DoAwayConfiguration(HomeId, this.Zones_data [i].id, basic_tree);
			await this.DoTimeTables(HomeId, this.Zones_data [i].id, basic_tree);
		}
	}

	async DoUser(HomeId){
		this.Users_data = await this.getZones(HomeId);
		this.log.debug('Users_data Result : ' + JSON.stringify(this.Users_data));
		this.DoWriteJsonRespons(HomeId,'Stage_15_ZonesData', this.Users_data);
	}

	async DoReadDevices(state_root,Devices_data, ){
		this.log.debug('Devices_data Result : ' + JSON.stringify(Devices_data));
		this.TraverseJson(Devices_data, 'TEST.' + state_root + '.DoReadDevides');
	}

	async DoZoneStates(HomeId,ZoneId, state_root_states){
		const ZonesState_data = await this.getZoneState(HomeId, ZoneId);
		this.log.debug('ZoneStates_data Result for zone : ' + ZoneId + ' and value : ' + JSON.stringify(ZonesState_data));
		this.DoWriteJsonRespons(HomeId,'Stage_09_ZoneStates_data_' +  ZoneId, ZonesState_data);
		this.TraverseJson(ZonesState_data, 'TEST.' + HomeId + '.Rooms.' + state_root_states);
	}

	// Unclear purpose, ignore for now
	async DoZoneCapabilities(HomeId,ZoneId){
		const ZoneCapabilities_data = await this.getZoneCapabilities(HomeId, ZoneId);
		this.log.debug('ZoneCapabilities_data Result : ' + JSON.stringify(ZoneCapabilities_data));
		this.DoWriteJsonRespons(HomeId,'Stage_11_ZoneCapabilities_' + ZoneId, ZoneCapabilities_data);
	}

	// Unclear purpose, ignore for now only 404 error
	async DoZoneOverlay(HomeId,ZoneId){
		const ZoneOverlay_data = await this.getZoneOverlay(HomeId, ZoneId);
		this.log.debug('ZoneOverlay_data Result : ' + JSON.stringify(ZoneOverlay_data));
		this.DoWriteJsonRespons(HomeId,'Stage_12_ZoneOverlay_' + ZoneId, ZoneOverlay_data);
	}

	async DoTimeTables(HomeId,ZoneId,state_root_states){
		const TimeTables_data = await this.getTimeTables(HomeId, ZoneId);
		this.log.debug('ZoneOverlay_data Result : ' + JSON.stringify(TimeTables_data));
		this.DoWriteJsonRespons(HomeId,'Stage_13_TimeTables_' + ZoneId, TimeTables_data);
		this.TraverseJson(TimeTables_data, 'TEST.' + HomeId + '.Rooms.' + state_root_states + '.TimeTables');
	}

	async DoAwayConfiguration(HomeId,ZoneId, state_root_states){
		const AwayConfiguration_data = await this.getAwayConfiguration(HomeId, ZoneId);
		this.log.debug('AwayConfiguration_data Result : ' + JSON.stringify(AwayConfiguration_data));

		this.DoWriteJsonRespons(HomeId,'Stage_10_AwayConfiguration_' + ZoneId, AwayConfiguration_data);
		this.TraverseJson(AwayConfiguration_data, 'TEST.' + HomeId + '.Rooms.' + state_root_states + '.AwayConfig');
	}

	async  TraverseJson(o, parent = null) {
		let id = null;
		let value = null;
		let name = null;
	
		for (var i in o) {
			name = i;
			if (!!o[i] && typeof (o[i]) == 'object' && o[i] == '[object Object]') {
				if (parent == null) {
					id = i;
				} else {
					id = parent + '.' + i;
					if (o[i].name) { name = o[i].name }
					if (o[i].id) { id = parent + '.' + o[i].id }
				}
				this.log.debug('setObject with ' + id + ' and name: ' + name);
				this.setObject(id, {
					'type': 'channel',
					'common': {
						'name': name,
					},
					'native': {},
				});
				this.TraverseJson(o[i], id);
			} else {
				value = o[i];
				if (parent == null) {
					id = i;
				} else {
					id = parent + '.' + i
				}
				if (typeof (o[i]) == 'object') value = JSON.stringify(value);
				//this.log.info('create id ' + id + ' with value ' + value);
				this.create_state(id, name, value);
				//setStateCus(id, name, value);
			}
		}
	}

	async create_state(state, name, value, expire){
		this.log.debug('Create_state called for : ' + state + ' with value : ' + value);
		this.log.debug('Create_state called for : ' + name	 + ' with value : ' + value);
		const intervall_time = (this.config.intervall * 4);
		let writable  = false;


		// Define write state information
		try {

			if (state_attr[name].write === true) {
				this.subscribeStates(state);
				writable = true;
				this.log.debug('State subscribed!: ' + state);
			} else {
				state_attr[name].write = false;
			}

		} catch (error) {

			writable = false;

		}

		this.log.debug('Write value : ' + writable);

		try {
			await this.setObjectNotExistsAsync(state, {
				type: 'state',
				common: {
					name: state_attr[name].name,
					role: state_attr[name].role,
					type: state_attr[name].type,
					unit: state_attr[name].unit,
					read : true,
					write : writable
				},
				native: {},
			});
			// await this.setState(state, {val: value, ack: true, expire: intervall_time});
			try {
				if (expire === false){
					await this.setState(state, {val: value, ack: true});
				} else {
					await this.setState(state, {val: value, ack: true, expire: intervall_time});
				}

			} catch (error) {
				await this.setState(state, {val: value, ack: true, expire: intervall_time});

			}


			try {

				await this.extendObjectAsync(state, {
					type: 'state',
					common: {
						states : state_attr[name].states
					}
				});

			} catch (error) {

				// no states attributes found for state

			}

		} catch (error) {

			this.log.debug('No type defined for name: ' + name + ' | value: ' + value);
			await this.setObjectNotExistsAsync(state, {
				type: 'state',
				common: {
					name: name,
					read : true,
					write : false,
					role: 'state',
					type:'mixed'
				},
				native: {},
			});
			// await this.setState(state, {val: value, ack: true, expire: intervall_time});
			try {
				if (expire === false){
					await this.setState(state, {val: value, ack: true});
				} else {
					await this.setState(state, {val: value, ack: true, expire: intervall_time});
				}
			} catch (error) {
				await this.setState(state, {val: value, ack: true, expire: intervall_time});

			}
		}

	}

	async DoWriteJsonRespons(HomeId, state_name, value){
		this.log.debug('JSON data written for '  + state_name + ' with values : ' + JSON.stringify(value));
		this.log.debug('HomeId '  + HomeId + ' name : ' + state_name + state_name + ' value ' + JSON.stringify(value));

		await this.setObjectNotExistsAsync(HomeId + '._info.JSON_response', {
			type: 'channel',
			common: {
				name: 'Plain JSON data from API',
			},
			native: {},
		});

		// await this.setState(HomeId + '._info.JSON_response.' + name,name, {val: value, ack: true});
		await this.create_state(HomeId + '._info.JSON_response.' + state_name, state_name, JSON.stringify(value));

	}

	async Count_remainingTimeInSeconds(state, value){

		(function () {if (counter[state]) {clearTimeout(counter[state]); counter[state] = null;}})();
		// timer
		counter[state] = setTimeout( () => {
			value = value - 1;
			this.setState(state, {val: value, ack: true});
			if (value > 0 ) {
				this.Count_remainingTimeInSeconds(state,value);
			}
		}, 1000);

	}

	async errorHandling (codePart, error) {
		this.log.error(`[${codePart}] error: ${error.message}, stack: ${error.stack}`);
		if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
			const sentryInstance = this.getPluginInstance('sentry');
			if (sentryInstance) {
				sentryInstance.getSentryObject().captureException(error);
			}
		}
	}

}

// @ts-ignore parent is a valid property on module
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Tado(options);
} else {
	// otherwise start the instance directly
	new Tado();
}
