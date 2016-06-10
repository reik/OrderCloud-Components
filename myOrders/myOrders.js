angular.module( 'orderCloud' )

    .config( MyOrdersConfig )
    .controller( 'MyOrdersCtrl', MyOrdersController )
    .controller( 'MyOrderEditCtrl', MyOrderEditController )
    .factory( 'MyOrdersTypeAheadSearchFactory', MyOrdersTypeAheadSearchFactory )
;

function MyOrdersConfig( $stateProvider ) {
    $stateProvider
        .state( 'myOrders', {
            parent: 'base',
            url: '/myorders',
            templateUrl:'myOrders/templates/myOrders.tpl.html',
            controller:'MyOrdersCtrl',
            controllerAs: 'myOrders',
            data: {componentName: 'My Orders'},
            resolve: {
                OrderList: function(OrderCloud) {
                    return OrderCloud.Me.ListIncomingOrders();
                }
            }
        })
        .state( 'myOrders.edit', {
            url: '/:orderid/edit',
            templateUrl:'myOrders/templates/MyorderEdit.tpl.html',
            controller:'MyOrderEditCtrl',
            controllerAs: 'myOrderEdit',
            resolve: {
                SelectedOrder: function($stateParams, OrderCloud) {
                    return OrderCloud.Me.GetOrder($stateParams.orderid);
                },
                SelectedPayments: function($stateParams, $q, OrderCloud){
                    var dfd = $q.defer();
                    var paymentList = {};


                    OrderCloud.Payments.List($stateParams.orderid, null, 1, 100)
                        .then(function(data) {
                            paymentList = data.Items;
                            dfd.resolve(paymentList);
                            angular.forEach(paymentList, function(payment){
                                if(payment.Type === 'CreditCard'){
                                    OrderCloud.CreditCards.Get(payment.CreditCardID)
                                        .then(function(cc){
                                            payment.creditCards = cc;
                                        })
                                }
                            });
                            dfd.resolve(paymentList);
                        });
                    return dfd.promise;

                },
                LineItemList: function($stateParams, OrderCloud) {
                    return OrderCloud.LineItems.List($stateParams.orderid);
                }
            }
        })
    ;
}

function MyOrdersController(OrderList) {
    var vm = this;
    vm.list = OrderList;
}

function MyOrderEditController( $scope, $q, $exceptionHandler, $state, OrderCloud, SelectedOrder, SelectedPayments, MyOrdersTypeAheadSearchFactory, LineItemList, toastr, OCGeography) {
    var vm = this,
        orderid = SelectedOrder.ID;
    vm.order = SelectedOrder;
    vm.orderID = SelectedOrder.ID;
    vm.list = LineItemList;
    vm.paymentList = SelectedPayments;
    vm.states = OCGeography.states;
    vm.countries = OCGeography.countries;


    vm.pagingfunction = PagingFunction;
    $scope.isCollapsedPayment = true;
    $scope.isCollapsedBilling = true;
    $scope.isCollapsedShipping = true;

    vm.deletePayment = function(payment){
        OrderCloud.Payments.Delete(orderid, payment.ID)
            .then(function(){
                $state.go($state.current, {}, {reload:true});
            })
            .catch(function(ex){
                $exceptionHandler(ex)
            });
    };

    vm.deleteLineItem = function(lineitem) {
        OrderCloud.LineItems.Delete(orderid, lineitem.ID)
            .then(function() {
                $state.go($state.current, {}, {reload: true});
            })
            .catch(function(ex) {
                $exceptionHandler(ex)
            });
    };

    vm.updateBillingAddress = function(){
        vm.order.BillingAddressID = null;
        vm.order.BillingAddress.ID = null;
        OrderCloud.Orders.Update(orderid, vm.order)
            .then(function(){
                OrderCloud.Orders.SetBillingAddress(orderid, vm.order.BillingAddress)
                    .then(function() {
                        $state.go($state.current, {}, {reload: true});
                    });
            })
    };

    vm.updateShippingAddress = function(){
        OrderCloud.Orders.SetShippingAddress(orderid, vm.ShippingAddress);
        //.then(function() {
        //    $state.go($state.current, {}, {reload: true});
        //});
    };

    vm.Submit = function() {
        var dfd = $q.defer();
        var queue = [];
        angular.forEach(vm.list.Items, function(lineitem, index) {
            if ($scope.EditForm.PaymentInfo.LineItems['Quantity' + index].$dirty || $scope.EditForm.PaymentInfo.LineItems['UnitPrice' + index].$dirty ) {
                queue.push(OrderCloud.LineItems.Update(orderid, lineitem.ID, lineitem));
            }
        });
        $q.all(queue)
            .then(function() {
                dfd.resolve();
                OrderCloud.Orders.Update(orderid, vm.order)
                    .then(function() {
                        toastr.success('Order Updated', 'Success');
                        $state.go('myOrders', {}, {reload:true});
                    })
                    .catch(function(ex) {
                        $exceptionHandler(ex)
                    });
            })
            .catch(function(ex) {
                $exceptionHandler(ex)
            });

        return dfd.promise;
    };

    vm.Delete = function() {
        OrderCloud.Orders.Delete(orderid)
            .then(function() {
                $state.go('myOrders', {}, {reload:true});
                toastr.success('Order Deleted', 'Success');
            })
            .catch(function(ex) {
                $exceptionHandler(ex)
            });
    };

    function PagingFunction() {
        if (vm.list.Meta.Page < vm.list.Meta.PageSize) {
            OrderCloud.LineItems.List(vm.order.ID, vm.list.Meta.Page + 1, vm.list.Meta.PageSize).then(
                function(data) {
                    vm.list.Meta = data.Meta;
                    vm.list.Items = [].concat(vm.list.Items, data.Items);
                }
            )
        }
    }
    vm.spendingAccountTypeAhead = MyOrdersTypeAheadSearchFactory.SpendingAccountList;
    vm.shippingAddressTypeAhead = MyOrdersTypeAheadSearchFactory.ShippingAddressList;
    vm.billingAddressTypeAhead = MyOrdersTypeAheadSearchFactory.BillingAddressList;
}

function MyOrdersTypeAheadSearchFactory($q, OrderCloud, Underscore) {
    return {
        SpendingAccountList: SpendingAccountList,
        ShippingAddressList: ShippingAddressList,
        BillingAddressList: BillingAddressList
    };

    function SpendingAccountList(term) {
        return OrderCloud.SpendingAccounts.List(term).then(function(data) {
            return data.Items;
        });
    }

    function ShippingAddressList(term) {
        var dfd = $q.defer();
        var queue = [];
        queue.push(OrderCloud.Addresses.List(term));
        queue.push(OrderCloud.Addresses.ListAssignments(null, null, null, null, true));
        $q.all(queue)
            .then(function(result) {
                var searchAssigned = Underscore.intersection(Underscore.pluck(result[0].Items, 'ID'), Underscore.pluck(result[1].Items, 'AddressID'));
                var addressList = Underscore.filter(result[0].Items, function(address) {
                    if (searchAssigned.indexOf(address.ID) > -1) {
                        return address;
                    }
                });
                dfd.resolve(addressList);
            });
        return dfd.promise;
    }

    function BillingAddressList(term) {
        var dfd = $q.defer();
        var queue = [];
        queue.push(OrderCloud.Addresses.List(term));
        queue.push(OrderCloud.Addresses.ListAssignments(null, null, null, null, null, true));
        $q.all(queue)
            .then(function(result) {
                var searchAssigned = Underscore.intersection(Underscore.pluck(result[0].Items, 'ID'), Underscore.pluck(result[1].Items, 'AddressID'));
                var addressList = Underscore.filter(result[0].Items, function(address) {
                    if (searchAssigned.indexOf(address.ID) > -1) {
                        return address;
                    }
                });
                dfd.resolve(addressList);
            });
        return dfd.promise;
    }
}