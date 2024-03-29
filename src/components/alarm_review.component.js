import * as React from "react";
import { observer, inject } from "mobx-react";
import Moment from "react-moment";
import { Table, Pagination, Grid, Segment, Button, Loader, Label, Icon, Popup, Message } from "semantic-ui-react";
import AlertUtil from '../util/alert-util';
import Pie from "./visualizations/Pie";

import "./alarm_review.component.css";
import LoaderComponent from "./utils/loader.component";
import DatePicker from "react-datepicker";
import moment from "moment";
import DetailsAlertModal from "../components/details.alert.modal.component";

import {subscribeToNewAlertEvents, unsubscribeFromNewAlertEvents} from '../util/web-socket';
import AlertListComponent from "./alert.list.component";

@inject("generalDataStore", "usersStore", "deviceStore", "alertStore", "alarmStore", "dataCollectorStore")
@observer
class AlarmReviewComponent extends React.Component {

  subscriber = null;

  colorsOpacityMap = {
    "INFO": "rgba(93, 156, 236, 0.2)",
    "LOW": "rgba(250, 215, 50, 0.2)",
    "MEDIUM": "rgba(255, 144, 43, 0.2)",
    "HIGH": "rgba(240, 80, 80, 0.2)"
  }

  colorsMap = AlertUtil.getColorsMap();

  constructor(props) {
    super(props);

    this.state = {
      range: 'DAY',
      customRange: false,
      isLoading: true,
      isGraphsLoading: true,
      isStatusLoading: false,
      activePage: 1,
      pageSize: 20,
      alerts: [],
      count: null,
      alertsCount: null,
      types: [],
      risks: [],
      statuses: [],
      dataCollectors: [],
      orderBy: ['created_at', 'DESC'],
      showFilters: true,
      selectedAlert: null,
      newAlerts: false,
      criteria: {
        type: [],
        risk: [],
        dataCollector: [],
        resolved: false,
        from: null,
        to: null
      }
    };
  }

  componentWillMount() {
    this.updateRange('DAY');
    this.subscriber = subscribeToNewAlertEvents(() => {
      this.setState({newAlerts: true});
    });
  }

  componentWillUnmount() {
    unsubscribeFromNewAlertEvents(this.subscriber);
  }

  loadAlertsAndCounts = () => {
    const alarmsDataPromise = this.props.alertStore.query({page: this.state.activePage-1, size: this.state.pageSize, order: this.state.orderBy}, this.state.criteria);
    const alarmsTypesPromise = this.props.alarmStore.getAlertsTypeCount(this.state.criteria.from, this.state.criteria.to);
    const alertsCountPromise = this.props.alertStore.count('TOTAL', {from: this.state.criteria.from, to: this.state.criteria.to});
    const unresolvedAlertsCountPromise = this.props.alertStore.count('TOTAL', {from: this.state.criteria.from, to: this.state.criteria.to, resolved: false});

    const dataCollectorsPromise = this.props.dataCollectorStore.getDataCollectorApi(this.state.criteria.from, this.state.criteria.to);
    
    Promise.all([alarmsDataPromise, alarmsTypesPromise, alertsCountPromise, unresolvedAlertsCountPromise, dataCollectorsPromise]).then(
      (responses) => {
        this.alarmsTypesMap = {};
        
        const alarmsTypesMap = {};
        responses[1].forEach((alarmType) => {
          alarmsTypesMap[alarmType.code] = alarmType;
        });

        const alertsCount = responses[2].data.count;
        const unresolvedAlertsCount = responses[3].data.count;
        const resolvedAlertsCount = alertsCount - unresolvedAlertsCount;
        const statuses = [
          {label: 'RESOLVED', percentage: alertsCount ? resolvedAlertsCount/alertsCount : 0, value: resolvedAlertsCount, color: '#5d9cec'},
          {label: 'UNRESOLVED', selected: true, percentage: alertsCount ? unresolvedAlertsCount/alertsCount : 0, value: unresolvedAlertsCount, color: '#f05050'},
        ];
        const types = responses[1].map(type => {return {label: type.name, description: type.description, percentage: alertsCount ? type.count/alertsCount : 0, value: type.count, code: type.code }});
        const dataCollectors = responses[4].map(dc => {return {label: dc.name, percentage: alertsCount ? dc.count/alertsCount : 0, value: dc.count, id: dc.id }});

        const mapRisks = {
          'HIGH': 0,
          'MEDIUM': 0,
          'LOW': 0,
          'INFO': 0
        }

        responses[1].forEach(type => mapRisks[type.risk] += type.count);

        const risks = Object.keys(mapRisks).map(key => { return {label: key, value: mapRisks[key], percentage: alertsCount ? mapRisks[key]/alertsCount : 0, color: this.colorsMap[key]}});
        const colors = ['#38b9dc', '#1f77b4', '#103350', '#9467bd', '#2185d0'];

        const filteredRisks = risks.filter ( r => r.value !== 0);
        const filteredTypes = types.filter( t =>  t.value !== 0);
        const filteredDataCollectors = dataCollectors.filter( dc =>  dc.value !== 0);

        filteredTypes.forEach( (item, index) => item.color = colors[index%5]);
        filteredDataCollectors.forEach( (item, index) => item.color = colors[index%5]);

        this.setState({
          isLoading: false,
          isGraphsLoading: false,
          alertsCount: unresolvedAlertsCount,
          count: alertsCount,
          statuses,
          dataCollectors: filteredDataCollectors,
          types: filteredTypes,
          risks: filteredRisks,
          alerts: responses[0].data,
          alarmsTypesMap
        });
     }
    );

  }
  
  handleAlertResolution = () => {
    const { alertsCount, pageSize, criteria, statuses, orderBy } = this.state;
    this.setState({activePage: 1, isLoading: true, isStatusLoading: true});
    const resolvedItem = statuses.find(item => item.label === 'RESOLVED');
    const unresolvedItem = statuses.find(item => item.label === 'UNRESOLVED');
    resolvedItem.value ++;
    resolvedItem.percentage = alertsCount ? resolvedItem.value/alertsCount : 0;
    unresolvedItem.value --;
    unresolvedItem.percentage = alertsCount ? unresolvedItem.value/alertsCount : 0;
    this.setState({isStatusLoading: false, statuses: [resolvedItem, unresolvedItem]});

    const alertsPromise = this.props.alertStore.query({page: 0, size: pageSize, order: orderBy}, criteria);

    Promise.all([alertsPromise]).then(
      (responses) => {
        this.setState({
          alerts: responses[0].data,
          isLoading: false
        });
      }
    );
  }

  handlePaginationChange = (e, { activePage }) => {
    this.setState({ activePage, isLoading: true });
    const { criteria, pageSize, selectedAlert } = this.state;

    const alertsPromise = this.props.alertStore.query({page: activePage-1, size: pageSize, order: this.state.orderBy}, criteria)
    
    Promise.all([alertsPromise]).then(
      (responses) => {
        this.setState({
          alerts: responses[0].data,
          isLoading: false
        });

        if (selectedAlert) {
          if (selectedAlert.index === 0) {
            this.showAlertDetails(responses[0].data.length-1)
          } else if (selectedAlert.index < pageSize) {
            this.showAlertDetails(0)
          }
        }
      }
    );
  }

  handleFromDateChange = moment => {
    const { criteria } = this.state;
    if(moment) criteria['from'] = moment.toDate();
    else criteria['from'] = null;
    this.setState({criteria, range: null});
  }

  handleToDateChange = moment => {
    const { criteria } = this.state;
    if(moment) criteria['to'] = moment.toDate();
    else criteria['to'] = null;
    this.setState({ criteria, range: null });
  }

  handleDateFilterClick = () => {
    const { criteria } = this.state;

    criteria.type = [];
    criteria.risk = [];
    criteria.resolved = false;
    criteria.dataCollector = [];

    this.setState({customRange: true, activePage: 1, isLoading: true, isGraphsLoading: true, criteria});

    this.loadAlertsAndCounts();
  }

  updateRange = range => {
    const { criteria } = this.state;

    criteria.type = [];
    criteria.risk = [];
    criteria.resolved = false;
    criteria.dataCollector = [];

    const auxDate = new Date();
    criteria.to = new Date();
    if(range === 'DAY') {
      auxDate.setDate(auxDate.getDate()-1);
    } else if (range === 'WEEK') {
      auxDate.setDate(auxDate.getDate()-7);
    } else if(range === 'MONTH') {
      auxDate.setMonth(auxDate.getMonth()-1);
    }
    criteria.from = auxDate;

    this.setState({customRange: false, activePage: 1, isLoading: true, isGraphsLoading: true, criteria, range});

    this.loadAlertsAndCounts();
  }

  handleItemSelected = (array, selectedItem, type) => {
    const foundItem = array.find(item => item.label === selectedItem.label);
    foundItem.selected = !foundItem.selected;

    const { criteria, pageSize } = this.state;

    switch(type) {
      case 'statuses':
        const theOtherItem = array.find(item => item.label !== selectedItem.label);
        if(foundItem.label === 'RESOLVED') {  
          if(foundItem.selected) {
            theOtherItem.selected = false;
            criteria.resolved = true;
          } else {
            criteria.resolved = null;
          }
        } else {
          if(foundItem.selected) {
            theOtherItem.selected = false;
            criteria.resolved = false;
          } else {
            criteria.resolved = null;
          }
        }        
        break;

      case 'types':
        criteria.type = array.filter(item => item.selected).map(item => item.code);
        break;

      case 'risks':
        criteria.risk = array.filter(risk => risk.selected).map(risk => risk.label);
        break;
      
      case 'dataCollectors':
        criteria.dataCollector = array.filter(dc => dc.selected).map(dc => dc.id);
    }

    this.setState({[type]: array, activePage: 1, isLoading: true, criteria});

    const alertsPromise = this.props.alertStore.query({page: 0, size: pageSize, order: this.state.orderBy}, criteria);
    const countPromise = this.props.alertStore.count('TOTAL', criteria);

    Promise.all([alertsPromise, countPromise]).then(
      responses => {
        const alerts = responses[0].data;
        const alertsCount = responses[1].data.count;
        this.setState({
          alertsCount,
          alerts,
          isLoading: false
        });
      }
    );
  }

  handleSort = field => {
    const { orderBy, criteria, pageSize } = this.state;
    if(orderBy[0] === field) {
      orderBy[1] = orderBy[1] === 'ASC' ? 'DESC' : 'ASC';
    }
    this.setState({activePage: 1, isLoading: true, orderBy});
    const alertsPromise = this.props.alertStore.query({page: 0, size: pageSize, order: orderBy}, criteria);
    const countPromise = this.props.alertStore.count('TOTAL', criteria);
    Promise.all([alertsPromise, countPromise]).then(
      responses => {
        const alerts = responses[0].data;
        const alertsCount = responses[1].data.count;
        this.setState({
          alertsCount,
          alerts,
          isLoading: false
        });
      }
    );
  }

  showAlertDetails = (index) => {
    const alert = this.state.alerts[index];

    const selectedAlert = {
      index,
      alert,
      alert_type: this.state.alarmsTypesMap[alert.type],
      isFirst: this.state.activePage === 1 && index === 0,
      isLast: this.state.activePage === Math.ceil(this.state.alertsCount/this.state.pageSize) && index === this.state.alerts.length-1
    }

    this.setState({ selectedAlert });
  }

  goToAlert = (direction) => {
    if (this.state.selectedAlert.index === 0 && direction < 0) {
      if (this.state.activePage > 1) {
        this.handlePaginationChange(null, {activePage: this.state.activePage-1})
      }
        
      return;
    }

    if (this.state.selectedAlert.index === this.state.alerts.length-1 && direction > 0) {
      if (this.state.activePage < Math.ceil(this.state.alertsCount/this.state.pageSize)) {
        this.handlePaginationChange(null, {activePage: this.state.activePage+1})
      }
      
      return;
    }

    const newIndex = this.state.selectedAlert.index + direction;
    this.showAlertDetails(newIndex);
  }

  closeAlertDetails = () => {
    this.setState({ selectedAlert: null });
  }

  clearDateRange() {
    this.updateRange('DAY');
  }

  render() {
    let { activePage, alertsCount, count, pageSize, statuses, risks, types, dataCollectors, criteria, orderBy, showFilters, range, selectedAlert, newAlerts, customRange } = this.state;
    let totalPages = Math.ceil(alertsCount/pageSize);
    const filteredStatuses = statuses.filter(status => status.selected);
    const filteredRisks = risks.filter(risk => risk.selected);
    const filteredTypes = types.filter(type => type.selected);
    const filteredDataCollectors = dataCollectors.filter(dc => dc.selected);

    return (
      <div className="app-body-container-view">
        <div className="animated fadeIn animation-view">
          <div className="view-header">
            <h1 className="mb0">ALERTS</h1>
            <div className="view-header-actions">
              {!showFilters &&
                <div onClick={() => this.setState({showFilters: true})}>
                  <i className="fas fa-eye" />
                  <span>SHOW SEARCH AND CHARTS</span>
                </div>
              }
              {showFilters &&
                <div onClick={() => this.setState({showFilters: false})} style={{color: 'gray'}}>
                  <i className="fas fa-eye-slash" />
                  <span>HIDE SEARCH AND CHARTS</span>
                </div>
              }
            </div>
          </div>
          {showFilters && 
            <Segment>
              <Grid className="animated fadeIn">
                <Grid.Row columns={16} className="data-container pl pr">
                  <Grid.Column id="datepicker-container" floated="left" mobile={16} tablet={16} computer={12}  className="tablet-no-margin-top">
                    <Grid className="animated fadeIn">
                      <Grid.Row columns={16} className="data-container pl pr">
                        <Grid.Column className="pr0" floated="left" mobile={15} tablet={15} computer={7}>
                          <div className="search-box input-box">
                            <i className="fas fa-calendar-alt" />
                            <DatePicker
                                selectsStart
                                startDate={criteria.from ? moment(criteria.from) : null}
                                endDate={criteria.to ? moment(criteria.to) : null}
                                maxDate={criteria.to ? moment(criteria.to) : null}
                                placeholderText="Select a start date"
                                selected={criteria.from ? moment(criteria.from) : null}
                                onChange={this.handleFromDateChange}
                                showTimeSelect
                                timeFormat="HH:mm"
                                timeIntervals={15}
                                isClearable={true}
                                dateFormat="MMMM D YYYY hh:mm a"
                            />
                          </div>
                        </Grid.Column>
                        <Grid.Column className="pr0" floated="left" mobile={15} tablet={15} computer={7}>
                          <div className="search-box input-box">
                            <i className="fas fa-calendar-alt" />
                            <DatePicker
                              fluid
                              selectsEnd
                              startDate={criteria.from ? moment(criteria.from) : null}
                              endDate={criteria.to ? moment(criteria.to) : null}
                              minDate={criteria.from ? moment(criteria.from) : null}
                              placeholderText="Select a finish date"
                              selected={criteria.to ? moment(criteria.to) : null}
                              onChange={this.handleToDateChange}
                              showTimeSelect
                              timeFormat="HH:mm"
                              timeIntervals={15}
                              isClearable={true}
                              dateFormat="MMMM D YYYY hh:mm a"
                            />
                          </div>
                        </Grid.Column>
                        <Grid.Column className="pl0" floated="left" mobile={1} tablet={1} computer={2}>
                          <Button disabled={this.state.isGraphsLoading || this.state.isLoading} loading={this.state.isGraphsLoading} onClick={this.handleDateFilterClick} icon>
                            <Icon name='check circle' />
                          </Button>
                        </Grid.Column>
                      </Grid.Row>
                    </Grid>
                  </Grid.Column>
                  <div id="range-container">
                    <Button.Group basic size='mini'>
                      <Button active={this.state.range === 'MONTH'} onClick={() => {this.updateRange('MONTH')}}>Last month</Button>
                      <Button active={this.state.range === 'WEEK'} onClick={() => {this.updateRange('WEEK')}}>Last week</Button>
                      <Button active={this.state.range === 'DAY'} onClick={() => {this.updateRange('DAY')}}>Last day</Button>
                    </Button.Group>
                  </div>
                </Grid.Row>
                <Grid.Row id="visualization-container" className="data-container pl pr">
                <Grid.Column className="data-container-box pl0 pr0" mobile={16} tablet={8} computer={4}>
                  <div className="box-data">
                    <h5 className="visualization-title">BY RISK</h5>
                    <Loader active={this.state.isGraphsLoading === true} />
                    <Pie 
                      isLoading={this.state.isGraphsLoading}
                      data={risks}
                      type={'risks'}
                      handler={this.handleItemSelected}
                    />
                  </div>
                </Grid.Column>
                <Grid.Column className="data-container-box pl0 pr0" mobile={16} tablet={8} computer={4}>
                  <div className="box-data">
                    <h5 className="visualization-title">BY STATUS</h5>
                    <Loader active={this.state.isGraphsLoading || this.state.isStatusLoading } />
                    <Pie
                      isLoading={this.state.isGraphsLoading}
                      data={statuses}
                      type={'statuses'}
                      handler={this.handleItemSelected}
                    />
                  </div>
                </Grid.Column>
                <Grid.Column className="data-container-box pl0 pr0" mobile={16} tablet={8} computer={4}>
                  <div className="box-data">
                    <h5 className="visualization-title">BY ALERT DESCRIPTION</h5>
                    <Loader active={this.state.isGraphsLoading === true} />
                    <Pie 
                      isLoading={this.state.isGraphsLoading}
                      data={types}
                      type={'types'}
                      handler={this.handleItemSelected}
                    />
                  </div>
                </Grid.Column>
                <Grid.Column className="data-container-box pl0 pr0" mobile={16} tablet={8} computer={4}>
                  <div className="box-data">
                    <h5 className="visualization-title">BY MESSAGE COLLECTOR</h5>
                    <Loader active={this.state.isGraphsLoading === true} />
                    <Pie
                      isLoading={this.state.isGraphsLoading}
                      data={dataCollectors}
                      type={'dataCollectors'}
                      handler={this.handleItemSelected}
                    />
                  </div>
                </Grid.Column>
              </Grid.Row>
            </Grid>
          </Segment>}
          <div className="view-body">            
            <div className="table-container">
              <div className="table-container-box">
              <Segment>
                <div>
                  <label style={{fontWeight: 'bolder'}}>Filters: </label>
                  {range && <Label as='a'>{'LAST ' + range}</Label>}

                  {customRange && criteria.from && criteria.to && <Label as='a' onClick={() => {this.clearDateRange()}}>FROM <Moment format="YYYY-MM-DD HH:mm">{criteria.from}</Moment> TO <Moment format="YYYY-MM-DD HH:mm">{criteria.to}</Moment> <Icon name='delete'/> </Label>}

                  {filteredStatuses.map( (status, index) => <Label as='a' key={'status'+index} className="text-uppercase" onClick={() => {this.handleItemSelected(statuses, status, 'statuses')}}>{status.label}<Icon name='delete'/></Label>)}
                  {filteredRisks.map( (risk, index) => <Label as='a' key={'risk'+index} className="text-uppercase" onClick={() => {this.handleItemSelected(risks, risk, 'risks')}}>{risk.label}<Icon name='delete'/></Label>)}
                  {filteredTypes.map( (type, index) => <Popup
                  trigger={<Label as='a' key={'type'+index} className="text-uppercase" onClick={() => {this.handleItemSelected(types, type, 'types')}}>{type.label.length < 15 ? type.label : `${type.label.substring(0,15)}...`}<Icon name='delete'/></Label>}><Popup.Content>{type.label}</Popup.Content></Popup>)}
                  {filteredDataCollectors.map( (dc, index) => <Label as='a' key={'dc'+index} className="text-uppercase" onClick={() => {this.handleItemSelected(dataCollectors, dc, 'dataCollectors')}}>{dc.label}<Icon name='delete'/></Label>)}
                  <span className="range-select" onClick={() => this.updateRange('DAY')}>Clear</span>
                </div>
                {!this.state.isLoading &&
                  <Table className="animated fadeIn" basic="very" compact="very" sortable>
                    <Table.Header>
                      <Table.Row>
                        <Table.HeaderCell collapsing>ID/ADDRESS</Table.HeaderCell>
                        <Table.HeaderCell collapsing>RISK</Table.HeaderCell>
                        <Table.HeaderCell >DESCRIPTION</Table.HeaderCell>
                        <Table.HeaderCell collapsing sorted={orderBy[0] === 'created_at' ? (orderBy[1] === 'ASC' ? 'ascending' : 'descending') : null} onClick={ () => this.handleSort('created_at')}>
                          DATE
                        </Table.HeaderCell>
                        <Table.HeaderCell>GATEWAY</Table.HeaderCell>
                        <Table.HeaderCell>COLLECTOR</Table.HeaderCell>
                        <Table.HeaderCell collapsing>ACTIONS</Table.HeaderCell>
                      </Table.Row>
                    </Table.Header>
                    {!this.state.isLoading && 
                      <Table.Body>
                        {newAlerts && 
                        <Table.Row>
                          <Table.Cell colSpan='6' verticalAlign='middle' style={{textAlign: 'center'}}>
                            <Message info compact>
                              <Icon name='bell'/>
                              There're new alerts.&nbsp;&nbsp;<Button circular positive size='mini' icon='fas fa-sync' onClick={() => {this.updateRange('DAY');this.setState({newAlerts: false})}} content='Reload now'/>
                            </Message>
                          </Table.Cell>
                        </Table.Row>}
                        <AlertListComponent alerts={this.state.alerts} alert_types={this.state.alarmsTypesMap} handleAlertResolution={this.handleAlertResolution} showAlertDetails={this.showAlertDetails}/>
                      </Table.Body>
                    }
                  </Table>}
                  <Grid className="segment centered">
                  {this.state.isLoading && (
                    <LoaderComponent loadingMessage="Loading alerts ..." style={{marginBottom: 20}}/>
                  )}
                  {totalPages > 1 && !this.state.isLoading &&
                    <Pagination className="" activePage={activePage} onPageChange={this.handlePaginationChange} totalPages={totalPages} />}
                  </Grid>
                </Segment>

                {selectedAlert && <DetailsAlertModal loading={this.state.isLoading} alert={selectedAlert} onClose={this.closeAlertDetails} onNavigate={this.goToAlert}/>}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  }

export default AlarmReviewComponent;
