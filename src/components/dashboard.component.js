import * as React from "react";
import { observer, inject } from "mobx-react";
import { Table, Loader, Segment, Button, Dropdown } from "semantic-ui-react";
import {subscribeToNewAlertEvents, unsubscribeFromNewAlertEvents} from '../util/web-socket';

import moment from "moment";

import BarChart from "./visualizations/Bar";

import "./dashboard.component.css";
import microchipSvg from '../img/microchip.svg'
import LoaderComponent from "./utils/loader.component";
import DetailsAlertModal from "../components/details.alert.modal.component";
import DataCollectorTooltip from "./dashboard/data.collector.tooltip";
import AlertUtil from '../util/alert-util';
import AlertListComponent from "./alert.list.component";

@inject("generalDataStore", "usersStore", "deviceStore", "alarmStore", "alertStore", "dataCollectorStore")
@observer
class DashboardComponent extends React.Component {
  subscriber = null;
  
  constructor(props) {

    super(props);

    this.state = {
      dataCollectors: [],
      selectedDataCollectors: [],
      numberOfPreviewAlerts: 5,
      microchipUrl: microchipSvg,
      alarms: null,
      alertsCount: null,
      topAlerts: null,
      topAlertsLoading: true,
      isLoading: true,
      ...props,
      organization_name: "",
      isRefreshing: false,
      devices_count: 0,
      range: 'DAY',
      barsCount: 0,
      alertsCountArray: null,
      selectedAlert: null,
      visualizationXDomain: {
        from: null,
        to: null
      },
      lastUpdated: Date.now()
    };
  }

  updateRange(range, silent) {
    let barsCount = 0;
    let groupBy = 'DAY';
    let from, to, visualizationDomainFrom, visualizationDomainTo;

    this.setState({ lastUpdated: Date.now() })

    if(range === 'DAY') {
      groupBy = 'HOUR';
      barsCount = 26;
      from = moment().subtract(1, 'days').utc().format();
      to = moment().utc().format();

      visualizationDomainFrom = moment().subtract(1, 'days').subtract(1, 'hour').format("YYYY-MM-DD HH:mm:ss");
      visualizationDomainTo = moment().add(1, 'hour').format("YYYY-MM-DD HH:mm:ss");
    } else if(range === 'WEEK') {
      barsCount = 9;
      from = moment().subtract(7, 'days').utc().format("YYYY-MM-DD");
      to = moment().add(1, 'day').utc().format("YYYY-MM-DD");

      visualizationDomainFrom = moment().subtract(8, 'days').format("YYYY-MM-DD");
      visualizationDomainTo = moment().add(1, 'days').utc().format("YYYY-MM-DD");
    } else if(range === 'MONTH') {
      barsCount = 33;
      from = moment().subtract(1, 'month').utc().format("YYYY-MM-DD");
      to = moment().add(1, 'day').utc().format("YYYY-MM-DD");

      visualizationDomainFrom = moment().subtract(1, 'month').subtract(1, 'days').format("YYYY-MM-DD");
      visualizationDomainTo = moment().add(1, 'days').utc().format("YYYY-MM-DD");
    }

    const dataCollectors = this.state.selectedDataCollectors;

    this.setState({ newDevicesLoading: true && !silent })
    this.props.deviceStore.getNewDevicesCount({ groupBy, from, to, dataCollectors }).then(response => this.setState({
      newDevicesLoading: false
    }));

    this.setState({ packetsLoading: true && !silent})
    this.props.deviceStore.getPacketsCount({ groupBy, from, to, dataCollectors } ).then(response => this.setState({
      packetsLoading: false
    }));

    this.setState({ quarantineCountLoading: true && !silent})
    this.props.deviceStore.getQuarantineDeviceCount({groupBy, from, to, dataCollectors}).then(response => this.setState({
      quarantineCountLoading: false
    }));

    this.setState({ quarantineDeviceCountLoading: true && !silent })
    this.props.deviceStore.getQuarantineDeviceCount({from, to, dataCollectors}).then(response => this.setState({
      quarantineDeviceCountLoading: false
    }));

    this.getAlerts(groupBy, from, to, dataCollectors, silent);
    
    this.setState({
      range: range,
      barsCount: barsCount,
      isLoading: false,
      alertsCountArray: [],
      visualizationXDomain: {
        from: new Date(visualizationDomainFrom),
        to: new Date(visualizationDomainTo)
      }
    });
  }

  componentDidMount() {
    this.getDataCollectors();
    this.updateRange('DAY');
    this.getTopAlerts();

    this.subscriber = subscribeToNewAlertEvents(() => {
      const { lastUpdated, range } = this.state;

      if (Date.now() - lastUpdated > (60 * 1000)) {
        this.getTopAlerts(true);
        this.updateRange(range, true);
      }
    });
  }

  componentWillUnmount() {
    unsubscribeFromNewAlertEvents(this.subscriber);
  }

  handleAlertResolution = () => {
    this.getTopAlerts();
  }

  handleDataCollectorSelection = (e, { value } ) => {
    const { range } = this.state;

    this.setState({ selectedDataCollectors: value }, () => {
      this.updateRange(range, true);
      this.getTopAlerts();
    })
  }

  getDataCollectors() {
    this.setState({
      dataCollectorsLoading: true
    });

    const dataCollectorsPromise = this.props.dataCollectorStore.getDataCollectorApi();
    const dataCollectorsCountPromise = this.props.generalDataStore.getDataCollectorsCount();

    Promise.all([dataCollectorsPromise, dataCollectorsCountPromise]).then(
      (response) => {
        const totalCollectors = this.props.generalDataStore.dataCollectorsCount;
        let activeCollectors = this.props.dataCollectorStore.dataCollectorList.filter(collector => collector.status === 'CONNECTED').length || 0; 

        const dataCollectors = this.props.dataCollectorStore.dataCollectorList
          .filter(collector => collector.status === 'CONNECTED' || collector.status === 'DISCONNECTED')
          .sort((collector1, collector2) => collector1.name.localeCompare(collector2.name))
          .map((collector, index) => ({
              key: collector.id,
              text: collector.name,
              value: collector.id,
              label: { color: collector.status === 'CONNECTED' ? 'green' : 'red', empty: true, circular: true, size: 'mini' }
            }))

        this.setState({
          totalCollectors,
          activeCollectors,
          dataCollectorsLoading: false,
          isLoading: false,
          dataCollectors
        });
      }
    );
  }

  getTopAlerts(silent) {
    this.setState({
      topAlertsLoading: true && !silent
    });

    const from = moment().subtract(7, 'days').utc().format("YYYY-MM-DD");
    const topalertsPromise = this.props.alertStore.query({page: 0, size: this.state.numberOfPreviewAlerts}, {resolved: false, from, dataCollector: this.state.selectedDataCollectors});
    const alertsTypesPromise = this.props.alarmStore.getAlertsType();

    Promise.all([topalertsPromise, alertsTypesPromise]).then(
      (response) => {
        
        const alarmsTypesMap = {};
        response[1].forEach((alarmType) => {
          alarmsTypesMap[alarmType.code] = alarmType;
        });

        this.setState({
          topAlertsLoading: false,
          topAlerts: response[0].data,
          alarmsTypesMap
        });
      }
    );
  }

  getAlerts(groupBy, from, to, dataCollectors, silent) {
    this.setState({
      alertsCountLoading: true && !silent
    });

    this.props.alarmStore.getAlertsCount( { groupBy, from, to, dataCollectors }).then(
      (response) => {
        const alertsCountArray = [];

        const dateAttributeName = (groupBy === 'HOUR') ? 'hour' : 'date';
        const colorsMap = AlertUtil.colorsMap;

        const filteredResponse = response.filter(alertCount => alertCount.risk != null)

        filteredResponse.forEach((alarmCount, i) => {
          alertsCountArray.push({xValue: new Date(alarmCount[dateAttributeName]), yValue: alarmCount.count,color: colorsMap[alarmCount.risk]});
        });

        const alertsCount = filteredResponse.map(item => item.count).reduce((value, partialTotal) => value + partialTotal, 0);

        this.setState({
          alertsCountLoading: false,
          alertsCountArray: alertsCountArray,
          isLoading: false,
          alertsCount: alertsCount
        });
      }
    );
  }

  goToAlert = (direction) => {
    if (this.state.selectedAlert.index === 0 && direction < 0) {
      return;
    }

    if (this.state.selectedAlert.index === this.state.topAlerts.length-1 && direction > 0) {
      return;
    }

    const newIndex = this.state.selectedAlert.index + direction;
    this.showAlertDetails(newIndex);
  }

  showAlertDetails = (index) => {
    const alert = this.state.topAlerts[index];

    const selectedAlert = {
      index,
      alert,
      alert_type: this.state.alarmsTypesMap[alert.type],
      isFirst: index === 0,
      isLast: index === this.state.topAlerts.length-1
    }

    this.setState({ selectedAlert });
  }

  closeAlertDetails = () => {
    this.setState({ selectedAlert: null });
  }

  render() {
    let organization_name = this.props.usersStore.currentUser.organization_name;

    let { activeCollectors, totalCollectors, alertsCount, selectedAlert, dataCollectors, dataCollectorsLoading } = this.state;
    if (organization_name) {
      organization_name = organization_name.toUpperCase();
    }

    if (alertsCount && alertsCount >= 1000 && alertsCount < 1000000) {
      alertsCount = (alertsCount / 1000).toFixed(1) + "K";
    } else if(alertsCount && alertsCount >= 1000000) {
      alertsCount = (alertsCount / 1000000).toFixed(1) + "M";
    }

    let packetsCount = this.props.deviceStore.packetsCount;
    if(packetsCount && packetsCount >= 1000 && packetsCount < 1000000) {
      packetsCount = (packetsCount/1000).toFixed(1) + 'K';
    } else if(packetsCount && packetsCount >= 1000000) {
      packetsCount = (packetsCount/1000000).toFixed(1) + 'M';
    }

    return (
      <div className="app-body-container-view">
        <div className="animated fadeIn animation-view dashboard">
          <div className="view-header">
            {/* HEADER TITLE */}
            <h1>DASHBOARD</h1>
          </div>

          {/* VIEW BODY */}
          <div className="view-body">
            {this.state.isLoading && (
              <LoaderComponent loadingMessage="Loading dashboard..." />
            )}
            {!this.state.isLoading && (
              <div>
                <Segment>
                <div className="animated fadeIn">
                    <h3><i className="fas fa-sitemap"/> | MESSAGE COLLECTORS {
                    dataCollectorsLoading === true ?
                    <div className="ui active inline loader"/> :
                    <DataCollectorTooltip dataCollectors={dataCollectors} 
                      activeCollectors={activeCollectors} 
                      totalCollectors={totalCollectors}/>
                    }
                    </h3> 
                </div>
                

                <div style={{display: 'flex', marginTop: '0.9rem', marginBottom: '0.9rem'}}>
                  <Dropdown placeholder='Filter by message collector' 
                    fluid
                    clearable 
                    multiple 
                    search 
                    selection 
                    closeOnChange
                    options={dataCollectors} 
                    loading={dataCollectorsLoading} 
                    onChange={this.handleDataCollectorSelection}
                    icon={ { 
                      name: this.state.selectedDataCollectors && this.state.selectedDataCollectors.length > 0 ? 'delete' : 'dropdown',
                      link: true
                    }}
                  />
                </div>
                <div className='text-right' style={{marginTop: '0.9rem', marginBottom: '0.9rem'}}>
                  <Button.Group basic size='mini'>
                    <Button active={this.state.range === 'MONTH'} onClick={() => {this.updateRange('MONTH')}}>Last month</Button>
                    <Button active={this.state.range === 'WEEK'} onClick={() => {this.updateRange('WEEK')}}>Last week</Button>
                    <Button active={this.state.range === 'DAY'} onClick={() => {this.updateRange('DAY')}}>Last day</Button>
                  </Button.Group>
                </div>
                  <div id="visualizations" className="data-container ui grid">
                    <div className="animated fadeIn data-container-box four wide computer eight wide tablet sixteen wide mobile column">
                      <div className="box-data">
                        <BarChart isLoading={this.state.alertsCountLoading} data={this.state.alertsCountArray} domain={this.state.visualizationXDomain} barsCount={this.state.barsCount} range={this.state.range}/>
                        <Loader active={this.state.alertsCountLoading === true} />
                        <div className="box-data-legend">
                          <i className="fas fa-exclamation-circle" />
                          <div>
                            <h3>ALERTS</h3>
                            {
                              this.state.alertsCountLoading === true ? 
                              <div className="ui active inline loader"></div> :
                              <h2>{alertsCount}</h2>
                            }
                            </div>
                        </div>
                      </div>
                    </div>
                    <div className="animated fadeIn data-container-box four wide computer eight wide tablet sixteen wide mobile column">
                      <div className="box-data">
                        <BarChart isLoading={this.state.quarantineCountLoading} data={this.props.deviceStore.quarantineDeviceCountGrouped} domain={this.state.visualizationXDomain} barsCount={this.state.barsCount} range={this.state.range}/>
                        <Loader active={this.state.quarantineCountLoading === true} />
                        <div className="box-data-legend">
                          <i className="fas fa-bug" />
                          <div>
                            <h3>QUARANTINE</h3>
                            {
                              this.state.quarantineDeviceCountLoading === true ? 
                              <div className="ui active inline loader"></div> :
                              <h2>{this.props.deviceStore.quarantineDeviceCount}</h2>
                            }
                            </div>
                        </div>
                      </div>
                    </div>
                    <div className="animated fadeIn data-container-box four wide computer eight wide tablet sixteen wide mobile column">
                      <div className="box-data">
                        <BarChart isLoading={this.state.newDevicesLoading} data={this.props.deviceStore.newDevices} domain={this.state.visualizationXDomain} barsCount={this.state.barsCount} range={this.state.range}/>
                        <Loader active={this.state.newDevicesLoading === true} />
                        <div className="box-data-legend">
                          <i className="fas fa-microchip" />
                          <div>
                            <h3>DEVICES</h3>
                            {
                              this.state.newDevicesLoading === true ? 
                              <div className="ui active inline loader"></div> :
                              <h2>{this.props.deviceStore.devicesCount}</h2>
                            }
                            </div>
                        </div>
                      </div>
                    </div>
                    <div className="animated fadeIn data-container-box four wide computer eight wide tablet sixteen wide mobile column">
                      <div className="box-data">
                        <BarChart isLoading={this.state.packetsLoading} data={this.props.deviceStore.packets} domain={this.state.visualizationXDomain} barsCount={this.state.barsCount} range={this.state.range}/>
                        <Loader active={this.state.packetsLoading === true} />
                        <div className="box-data-legend">
                          <i className="fas fa-envelope" />
                          <div>
                            <h3>MESSAGES</h3>
                            {
                              this.state.packetsLoading === true ? 
                              <div className="ui active inline loader"></div> :
                              <h2>{packetsCount}</h2>
                            }
                            </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Segment>
                <Segment>
                  <div className="table-container">
                    <div className="table-container-box">
                      <h3>LATEST UNRESOLVED ALERTS</h3 >
                      <Loader active={this.state.topAlertsLoading === true} />
                      {!this.state.topAlertsLoading && <Table className="animated fadeIn" basic="very" compact="very">
                        <Table.Header>
                          <Table.Row>
                            <Table.HeaderCell collapsing>ID/ADDRESS</Table.HeaderCell>
                            <Table.HeaderCell collapsing>RISK</Table.HeaderCell>
                            <Table.HeaderCell>DESCRIPTION</Table.HeaderCell>
                            <Table.HeaderCell collapsing>DATE</Table.HeaderCell>
                            <Table.HeaderCell>GATEWAY</Table.HeaderCell>
                            <Table.HeaderCell>COLLECTOR</Table.HeaderCell>
                            <Table.HeaderCell collapsing>ACTIONS</Table.HeaderCell>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          <AlertListComponent alerts={this.state.topAlerts} alert_types={ this.state.alarmsTypesMap} handleAlertResolution={this.handleAlertResolution} showAlertDetails={this.showAlertDetails}/>
                        </Table.Body>
                      </Table>}
                    </div>
                  </div>
                </Segment>
                {selectedAlert && <DetailsAlertModal alert={selectedAlert} onClose={this.closeAlertDetails} onNavigate={this.goToAlert}/>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default DashboardComponent;
